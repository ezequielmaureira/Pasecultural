import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService } from "../src/services/event.service.js";
import {
    createScannerInvitationsService,
    disableScannerService,
    reactivateScannerService,
} from "../src/services/eventScanner.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";

// Developer > Planes (ver el informe de esa ronda). Enforcement real de
// maxActiveScanners — cupo de scanners REALMENTE ACTIVOS (status ===
// "ACTIVE" && deletedAt === null) de TODA la organización, nunca de
// invitaciones (INVITED nunca consume). El punto autoritativo es la
// ACTIVACIÓN (ver assertActiveScannerCapacity en eventScanner.service.js),
// compartido por las 2 transiciones reales a ACTIVE: el claim público por
// email+código (verifyScannerInvitationCodeService, scannerInvitation.
// service.js) y la reactivación DISABLED->ACTIVE desde el panel del
// organizador (reactivateScannerService, acá abajo). Esta suite ejercita
// reactivateScannerService — misma función compartida assertActiveScannerCapacity
// que usa el claim público, así que cubre el enforcement real sin tener que
// levantar el flujo completo de email+código de verificación. Se prueba
// contra Postgres real (backend/.env.test), nunca con mocks de Prisma.
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `user_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function createEvent(owner, org, title) {
    return createEventService(
        owner.clerkId,
        { title, location: { venueName: "Plaza Central", formattedAddress: "Calle Falsa 123" } },
        org.id
    );
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.eventScanner.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function snapshotPlanLimits() {
    const [free, premium] = await Promise.all([
        prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } }),
        prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } }),
    ]);
    return { FREE: free, PREMIUM: premium };
}

async function restorePlanLimits(snapshot) {
    for (const plan of ["FREE", "PREMIUM"]) {
        const original = snapshot[plan];
        if (!original) continue;
        const data = {
            maxActiveEvents: original.maxActiveEvents,
            maxCourtesiesPerEvent: original.maxCourtesiesPerEvent,
            maxActiveScanners: original.maxActiveScanners,
            maxTicketsPerEvent: original.maxTicketsPerEvent,
            publicOrgPageEnabled: original.publicOrgPageEnabled,
            whatsappEventCreationEnabled: original.whatsappEventCreationEnabled,
            featuredEligible: original.featuredEligible,
            updatedByUserId: original.updatedByUserId,
        };
        const current = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
        if (current) {
            await prisma.organizationPlanLimits.update({ where: { plan }, data });
        } else {
            await prisma.organizationPlanLimits.create({ data: { plan, ...data } });
        }
    }
}

// Cuenta EXACTAMENTE lo que debe contar assertActiveScannerCapacity — usada
// para verificar el resultado real en la base, nunca para decidir nada.
async function countActiveOrg(organizationId) {
    return prisma.eventScanner.count({
        where: { deletedAt: null, status: "ACTIVE", event: { organizationId } },
    });
}

// Setup-only: fuerza un EventScanner a un estado puntual sin pasar por el
// flujo real (email+código / reactivación) — nunca se usa para probar
// enforcement, sólo para armar la fixture de partida de cada test.
async function forceStatus(scannerId, status, extra = {}) {
    return prisma.eventScanner.update({ where: { id: scannerId }, data: { status, ...extra } });
}

testWithDb("A: 0 ACTIVE, varias invitaciones INVITED -> consumo = 0", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        event = await createEvent(owner, org, "Evento A");

        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 });
        assert.equal(scanners.length, 3);
        assert.ok(scanners.every((s) => s.status === "INVITED"));
        assert.equal(await countActiveOrg(org.id), 0, "ninguna invitación INVITED debe consumir cupo");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("B: límite 2, 2 ACTIVE -> un tercer scanner no puede ACTIVARSE", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 2 });
        event = await createEvent(owner, org, "Evento B");

        const [s1, s2, s3] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 });
        await forceStatus(s1.id, "ACTIVE", { activatedAt: new Date() });
        await forceStatus(s2.id, "ACTIVE", { activatedAt: new Date() });
        // s3 se deja como si hubiera estado activo y se hubiera desactivado —
        // así se puede ejercitar el gate real (reactivateScannerService) en
        // vez de forzar el estado ACTIVE directamente.
        await forceStatus(s3.id, "DISABLED");

        await assert.rejects(
            () => reactivateScannerService(owner.clerkId, event.id, s3.id),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await countActiveOrg(org.id), 2, "el cupo activo no debe haber cambiado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("C: límite 2, 2 ACTIVE, uno pasa a DISABLED -> queda un cupo disponible", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 2 });
        event = await createEvent(owner, org, "Evento C");

        const [s1, s2, s3] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 });
        await forceStatus(s1.id, "ACTIVE", { activatedAt: new Date() });
        await forceStatus(s2.id, "ACTIVE", { activatedAt: new Date() });
        await forceStatus(s3.id, "DISABLED");

        await assert.rejects(() => reactivateScannerService(owner.clerkId, event.id, s3.id));

        await disableScannerService(owner.clerkId, event.id, s1.id);
        assert.equal(await countActiveOrg(org.id), 1, "desactivar uno debe liberar un cupo");

        const reactivated = await reactivateScannerService(owner.clerkId, event.id, s3.id);
        assert.equal(reactivated.status, "ACTIVE");
        assert.equal(await countActiveOrg(org.id), 2, "con cupo libre, la activación debe pasar");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("D: un scanner DISABLED no consume cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        event = await createEvent(owner, org, "Evento D");

        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        await forceStatus(scanner.id, "DISABLED");

        assert.equal(await countActiveOrg(org.id), 0, "DISABLED no debe contar como cupo consumido");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("E: un scanner REVOKED no consume cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        event = await createEvent(owner, org, "Evento E");

        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        await forceStatus(scanner.id, "REVOKED");

        assert.equal(await countActiveOrg(org.id), 0, "REVOKED no debe contar como cupo consumido");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("F: un scanner con deletedAt no consume cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        event = await createEvent(owner, org, "Evento F");

        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        await forceStatus(scanner.id, "ACTIVE", { activatedAt: new Date(), deletedAt: new Date() });

        assert.equal(await countActiveOrg(org.id), 0, "un scanner eliminado (deletedAt) no debe contar aunque su status sea ACTIVE");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("G: varios scanners INVITED no consumen cupo (independiente de A, mismo chequeo aislado)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 0 });
        event = await createEvent(owner, org, "Evento G");

        // Límite 0 y aun así la creación de invitaciones nunca se bloquea:
        // el límite es de ACTIVOS, no de invitaciones.
        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 5 });
        assert.equal(scanners.length, 5);
        assert.equal(await countActiveOrg(org.id), 0);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("H: dos activaciones concurrentes no pueden superar el límite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        event = await createEvent(owner, org, "Evento H");

        const [s1, s2] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 2 });
        await forceStatus(s1.id, "DISABLED");
        await forceStatus(s2.id, "DISABLED");

        const results = await Promise.allSettled([
            reactivateScannerService(owner.clerkId, event.id, s1.id),
            reactivateScannerService(owner.clerkId, event.id, s2.id),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "sólo una de las dos activaciones concurrentes debe ganar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, "PLAN_SCANNER_LIMIT_REACHED");

        assert.equal(await countActiveOrg(org.id), 1, "el conteo real en la base nunca debe superar el límite");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("I: null (sin límite configurado) nunca bloquea la activación", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: null });
        event = await createEvent(owner, org, "Evento I");

        const [s1, s2, s3] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 });
        for (const s of [s1, s2, s3]) await forceStatus(s.id, "DISABLED");

        await reactivateScannerService(owner.clerkId, event.id, s1.id);
        await reactivateScannerService(owner.clerkId, event.id, s2.id);
        await reactivateScannerService(owner.clerkId, event.id, s3.id);

        assert.equal(await countActiveOrg(org.id), 3);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("J: el cupo es de la ORGANIZACIÓN — comparte límite entre distintos eventos", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let eventA, eventB;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveScanners: 1 });
        eventA = await createEvent(owner, org, "Evento J-A");
        eventB = await createEvent(owner, org, "Evento J-B");

        const [scannerA] = await createScannerInvitationsService(owner.clerkId, eventA.id, { gate: "Puerta 1", quantity: 1 });
        const [scannerB] = await createScannerInvitationsService(owner.clerkId, eventB.id, { gate: "Puerta 1", quantity: 1 });
        await forceStatus(scannerA.id, "ACTIVE", { activatedAt: new Date() });
        await forceStatus(scannerB.id, "DISABLED");

        await assert.rejects(
            () => reactivateScannerService(owner.clerkId, eventB.id, scannerB.id),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            },
            "el Event B comparte el mismo cupo de organización que ya agotó el Event A"
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: [eventA?.id, eventB?.id].filter(Boolean), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});
