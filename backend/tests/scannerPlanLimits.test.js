import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService } from "../src/services/event.service.js";
import {
    createScannerInvitationsService,
    revokeScannerInvitationService,
    deleteScannerService,
} from "../src/services/eventScanner.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";

// Premium — Fase 2B. Enforcement real de maxScannersPerEvent (scanner que
// consume cupo = deletedAt IS NULL AND status != REVOKED). Se prueba contra
// Postgres real (backend/.env.test), nunca con mocks de Prisma. Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
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
            maxScannersPerEvent: original.maxScannersPerEvent,
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

async function countCounting(eventId) {
    return prisma.eventScanner.count({ where: { eventId, deletedAt: null, status: { not: "REVOKED" } } });
}

testWithDb("SC-A: null (sin límite configurado) permite crear scanners", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: null });
        event = await createEvent(owner, org, "Evento SC-A");
        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scanners.length, 1);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-B: 0 bloquea toda creación nueva", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 0 });
        event = await createEvent(owner, org, "Evento SC-B");

        await assert.rejects(
            () => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
        const count = await prisma.eventScanner.count({ where: { eventId: event.id } });
        assert.equal(count, 0, "no debe haberse creado ningún scanner");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-C: debajo del límite permite crear", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 3 });
        event = await createEvent(owner, org, "Evento SC-C");
        await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scanners.length, 1);
        assert.equal(await countCounting(event.id), 2);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-D: exactamente en el límite bloquea la siguiente creación", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 2 });
        event = await createEvent(owner, org, "Evento SC-D");
        await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 2 });

        await assert.rejects(
            () => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await countCounting(event.id), 2);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-E: REVOKED libera cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        event = await createEvent(owner, org, "Evento SC-E");
        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });

        await assert.rejects(() => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }));

        await revokeScannerInvitationService(owner.clerkId, event.id, scanner.id);
        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scanners.length, 1, "revocar el primero debe haber liberado el cupo");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-F: deletedAt (eliminar) libera cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        event = await createEvent(owner, org, "Evento SC-F");
        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });

        await assert.rejects(() => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }));

        await deleteScannerService(owner.clerkId, event.id, scanner.id);
        const scanners = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scanners.length, 1, "eliminar el primero debe haber liberado el cupo");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-G: un scanner INVITED (nunca reclamado) consume cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        event = await createEvent(owner, org, "Evento SC-G");
        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scanner.status, "INVITED");

        await assert.rejects(
            () => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-H: un scanner DISABLED sigue consumiendo cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        event = await createEvent(owner, org, "Evento SC-H");
        const [scanner] = await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 });
        await prisma.eventScanner.update({ where: { id: scanner.id }, data: { status: "DISABLED" } });

        await assert.rejects(
            () => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-I: una quantity que excede el remanente bloquea la request completa (nunca creación parcial)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 5 });
        event = await createEvent(owner, org, "Evento SC-I");
        await createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 }); // 3/5, remanente 2

        await assert.rejects(
            () => createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 3 }),
            (error) => {
                assert.equal(error.code, "PLAN_SCANNER_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await countCounting(event.id), 3, "la request rechazada no debe haber creado ninguna fila");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-J: el Event A no cuenta scanners del Event B", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let eventA, eventB;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        eventA = await createEvent(owner, org, "Evento SC-J-A");
        eventB = await createEvent(owner, org, "Evento SC-J-B");

        await createScannerInvitationsService(owner.clerkId, eventA.id, { gate: "Puerta 1", quantity: 1 }); // A queda 1/1

        const scannersB = await createScannerInvitationsService(owner.clerkId, eventB.id, { gate: "Puerta 1", quantity: 1 });
        assert.equal(scannersB.length, 1, "el Event B tiene su propio cupo independiente del Event A");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: [eventA?.id, eventB?.id].filter(Boolean), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("SC-K: creaciones simultáneas no pueden superar el límite (concurrencia)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxScannersPerEvent: 1 });
        event = await createEvent(owner, org, "Evento SC-K");

        const results = await Promise.allSettled([
            createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 1", quantity: 1 }),
            createScannerInvitationsService(owner.clerkId, event.id, { gate: "Puerta 2", quantity: 1 }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "sólo una de las dos creaciones concurrentes debe ganar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, "PLAN_SCANNER_LIMIT_REACHED");

        assert.equal(await countCounting(event.id), 1, "el conteo real en la base nunca debe superar el límite");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});
