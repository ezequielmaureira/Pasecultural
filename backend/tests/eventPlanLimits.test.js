import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService, syncEventScheduleService, updateMyEventService, restoreEventService } from "../src/services/event.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";
import { updateMyEvent, restoreEvent } from "../src/controllers/event.controller.js";
import { ErrorCatalog } from "../src/errors/ErrorCatalog.js";

// Premium — Fase 2B. Enforcement real de maxActiveEvents (evento activo =
// status PUBLISHED && archivedAt IS NULL). CRUD + transacciones reales
// (Event/EventFunction, OrganizationPlanLimits), no expresable como
// funciones puras: se prueba contra Postgres real (backend/.env.test),
// nunca con mocks de Prisma. Guardrail centralizado — ver
// tests/helpers/dbGuard.js (NUNCA un segundo guardrail casero).
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

function locationInput(overrides = {}) {
    return {
        venueName: "Plaza Central",
        formattedAddress: "Calle Falsa 123",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

// FREE_ENTRY: evita tener que armar TicketType/precio/capacidad reales sólo
// para poder publicar — assertPublishable ya no exige catálogo para este
// admissionType (ver event.service.js). Mismo patrón que
// eventAdmissionType.test.js#A.
async function createDraftEvent(owner, org, title) {
    const event = await createEventService(
        owner.clerkId,
        { title, admissionType: "FREE_ENTRY", location: locationInput() },
        org.id
    );
    await syncEventScheduleService(
        owner.clerkId,
        event.id,
        { functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }], ticketTypes: [] },
        org.id
    );
    return event;
}

function publishEvent(owner, event, org) {
    return updateMyEventService(owner.clerkId, event.id, { status: "PUBLISHED" }, org.id);
}

// Mismo shape que organizationPlanLimits.crud.test.js#fakeReqWithAuth —
// event.controller.js llama getAuth(req) (@clerk/express) para resolver
// { userId }; estos tests ejercitan el controller REAL (no el service
// directo) porque lo que se está probando es el mapeo a HTTP, no la regla
// de negocio (ya cubierta por EV-A..EV-L).
function fakeReqWithAuth(clerkId, extra = {}) {
    const req = { headers: {}, body: {}, params: {}, query: {}, ...extra };
    req.auth = Object.assign(() => ({ userId: clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

function fakeRes() {
    const state = {};
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(body) {
            state.jsonBody = body;
            return res;
        },
        send() {
            return res;
        },
    };
    return { res, state };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
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

testWithDb("EV-A: null (sin límite configurado) permite publicar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: null });
        event = await createDraftEvent(owner, org, "Evento A");
        const published = await publishEvent(owner, event, org);
        assert.equal(published.status, "PUBLISHED");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-B: 0 bloquea toda publicación nueva", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 0 });
        event = await createDraftEvent(owner, org, "Evento B");

        await assert.rejects(
            () => publishEvent(owner, event, org),
            (error) => {
                assert.equal(error.message, "PLAN_ACTIVE_EVENT_LIMIT_REACHED");
                return true;
            }
        );
        const fresh = await prisma.event.findUnique({ where: { id: event.id } });
        assert.equal(fresh.status, "DRAFT", "no debe haber quedado publicado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-C: debajo del límite permite publicar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 3 });
        events.push(await createDraftEvent(owner, org, "C1"));
        await publishEvent(owner, events[0], org);

        events.push(await createDraftEvent(owner, org, "C2"));
        const published = await publishEvent(owner, events[1], org);
        assert.equal(published.status, "PUBLISHED");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-D: exactamente en el límite bloquea la siguiente publicación", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 2 });
        events.push(await createDraftEvent(owner, org, "D1"));
        await publishEvent(owner, events[0], org);
        events.push(await createDraftEvent(owner, org, "D2"));
        await publishEvent(owner, events[1], org);

        events.push(await createDraftEvent(owner, org, "D3"));
        await assert.rejects(
            () => publishEvent(owner, events[2], org),
            (error) => {
                assert.equal(error.message, "PLAN_ACTIVE_EVENT_LIMIT_REACHED");
                return true;
            }
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-E: crear/editar un DRAFT sigue permitido aunque el límite ya esté alcanzado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });
        events.push(await createDraftEvent(owner, org, "E1"));
        await publishEvent(owner, events[0], org); // 1/1 activo

        // Crear otro DRAFT y editarlo (sin tocar status) nunca debe bloquearse.
        events.push(await createDraftEvent(owner, org, "E2"));
        const edited = await updateMyEventService(owner.clerkId, events[1].id, { title: "E2 editado" }, org.id);
        assert.equal(edited.status, "DRAFT");
        assert.equal(edited.title, "E2 editado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-F: un evento archivado no consume cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });
        events.push(await createDraftEvent(owner, org, "F1"));
        await publishEvent(owner, events[0], org); // 1/1 activo
        // Simula archivado (el self-heal real depende de fechas/7 días — acá
        // se prueba directamente el predicado que usa el guard: archivedAt).
        await prisma.event.update({ where: { id: events[0].id }, data: { archivedAt: new Date() } });

        events.push(await createDraftEvent(owner, org, "F2"));
        const published = await publishEvent(owner, events[1], org);
        assert.equal(published.status, "PUBLISHED", "archivar F1 debe haber liberado el cupo");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-G: downgrade nunca despublica/archiva/borra eventos existentes por encima del nuevo límite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxActiveEvents: 20 });
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        for (const title of ["G1", "G2", "G3"]) {
            const event = await createDraftEvent(owner, org, title);
            await publishEvent(owner, event, org);
            events.push(event);
        }

        await prisma.organization.update({ where: { id: org.id }, data: { plan: "FREE" } });

        for (const event of events) {
            const fresh = await prisma.event.findUnique({ where: { id: event.id } });
            assert.equal(fresh.status, "PUBLISHED", "el downgrade no debe despublicar nada");
            assert.equal(fresh.archivedAt, null, "el downgrade no debe archivar nada");
        }
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-H: downgrade por encima del límite bloquea la siguiente activación", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxActiveEvents: 20 });
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        for (const title of ["H1", "H2"]) {
            const event = await createDraftEvent(owner, org, title);
            await publishEvent(owner, event, org);
            events.push(event);
        }

        await prisma.organization.update({ where: { id: org.id }, data: { plan: "FREE" } }); // 2/1, ya excedida

        events.push(await createDraftEvent(owner, org, "H3"));
        await assert.rejects(
            () => publishEvent(owner, events[2], org),
            (error) => {
                assert.equal(error.message, "PLAN_ACTIVE_EVENT_LIMIT_REACHED");
                return true;
            }
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-I: restaurar un PUBLISHED archivado respeta maxActiveEvents", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        const eventA = await createDraftEvent(owner, org, "I-A");
        events.push(eventA);
        await publishEvent(owner, eventA, org);
        await prisma.event.update({ where: { id: eventA.id }, data: { archivedAt: new Date() } }); // 0/1 activo

        const eventB = await createDraftEvent(owner, org, "I-B");
        events.push(eventB);
        await publishEvent(owner, eventB, org); // 1/1, ocupa el único cupo

        await assert.rejects(
            () => restoreEventService(owner.clerkId, eventA.id),
            (error) => {
                assert.equal(error.message, "PLAN_ACTIVE_EVENT_LIMIT_REACHED");
                return true;
            }
        );
        let freshA = await prisma.event.findUnique({ where: { id: eventA.id } });
        assert.notEqual(freshA.archivedAt, null, "no debe haberse restaurado mientras no hay cupo");

        // Libera el único cupo (archiva B) — ahora restaurar A debe funcionar.
        await prisma.event.update({ where: { id: eventB.id }, data: { archivedAt: new Date() } });
        const restored = await restoreEventService(owner.clerkId, eventA.id);
        assert.equal(restored.archivedAt, null);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-J: la Organization A no cuenta eventos activos de la Organization B", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        const eventA = await createDraftEvent(ownerA, orgA, "J-A");
        events.push(eventA);
        await publishEvent(ownerA, eventA, orgA); // orgA queda 1/1

        const eventB = await createDraftEvent(ownerB, orgB, "J-B");
        events.push(eventB);
        const publishedB = await publishEvent(ownerB, eventB, orgB);
        assert.equal(publishedB.status, "PUBLISHED", "orgB tiene su propio cupo independiente de orgA");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({
            eventIds: events.map((e) => e.id),
            organizationIds: [orgA.id, orgB.id],
            userIds: [ownerA.id, ownerB.id, developer.id],
        });
    }
});

testWithDb("EV-K: editar un evento YA publicado no se bloquea sólo por estar sobre el límite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        // Sin límite todavía: publica 2 eventos.
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: null });
        const eventA = await createDraftEvent(owner, org, "K-A");
        events.push(eventA);
        await publishEvent(owner, eventA, org);
        const eventB = await createDraftEvent(owner, org, "K-B");
        events.push(eventB);
        await publishEvent(owner, eventB, org);

        // Downgrade: la Organization queda con 2/1, por encima del límite.
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        // Editar el título de A (ya PUBLISHED), reenviando status: "PUBLISHED",
        // no debe bloquearse: no es una NUEVA alta, sigue activo como ya estaba.
        const edited = await updateMyEventService(
            owner.clerkId,
            eventA.id,
            { title: "K-A editado", status: "PUBLISHED" },
            org.id
        );
        assert.equal(edited.status, "PUBLISHED");
        assert.equal(edited.title, "K-A editado");

        // Editar sin mandar status en absoluto también debe funcionar.
        const editedNoStatus = await updateMyEventService(owner.clerkId, eventB.id, { title: "K-B editado" }, org.id);
        assert.equal(editedNoStatus.status, "PUBLISHED");
        assert.equal(editedNoStatus.title, "K-B editado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("EV-L: publicaciones simultáneas no pueden superar el límite (concurrencia)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        const eventA = await createDraftEvent(owner, org, "L-A");
        events.push(eventA);
        const eventB = await createDraftEvent(owner, org, "L-B");
        events.push(eventB);

        const results = await Promise.allSettled([publishEvent(owner, eventA, org), publishEvent(owner, eventB, org)]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "sólo una de las dos publicaciones concurrentes debe ganar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.message, "PLAN_ACTIVE_EVENT_LIMIT_REACHED");

        const activeCount = await prisma.event.count({
            where: { organizationId: org.id, status: "PUBLISHED", archivedAt: null },
        });
        assert.equal(activeCount, 1, "el conteo real en la base nunca debe superar el límite");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("HTTP-EV-A: publish bloqueado por el límite devuelve HTTP 409 con el código/mensaje real", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });
        const eventA = await createDraftEvent(owner, org, "HTTP-EV-A-1");
        events.push(eventA);
        await publishEvent(owner, eventA, org); // 1/1 activo

        const eventB = await createDraftEvent(owner, org, "HTTP-EV-A-2");
        events.push(eventB);

        const req = fakeReqWithAuth(owner.clerkId, { params: { id: eventB.id }, body: { status: "PUBLISHED" } });
        const { res, state } = fakeRes();
        await updateMyEvent(req, res);

        assert.equal(state.statusCode, 409);
        assert.equal(state.jsonBody.message, ErrorCatalog.PLAN_ACTIVE_EVENT_LIMIT_REACHED.userMessage);

        const fresh = await prisma.event.findUnique({ where: { id: eventB.id } });
        assert.equal(fresh.status, "DRAFT", "no debe haber quedado publicado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("HTTP-EV-B: restore bloqueado por el límite devuelve HTTP 409 con el código/mensaje real", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    const events = [];
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1 });

        const eventA = await createDraftEvent(owner, org, "HTTP-EV-B-A");
        events.push(eventA);
        await publishEvent(owner, eventA, org);
        await prisma.event.update({ where: { id: eventA.id }, data: { archivedAt: new Date() } }); // 0/1 activo

        const eventB = await createDraftEvent(owner, org, "HTTP-EV-B-B");
        events.push(eventB);
        await publishEvent(owner, eventB, org); // 1/1, ocupa el único cupo

        const req = fakeReqWithAuth(owner.clerkId, { params: { id: eventA.id } });
        const { res, state } = fakeRes();
        await restoreEvent(req, res);

        assert.equal(state.statusCode, 409);
        assert.equal(state.jsonBody.message, ErrorCatalog.PLAN_ACTIVE_EVENT_LIMIT_REACHED.userMessage);

        const fresh = await prisma.event.findUnique({ where: { id: eventA.id } });
        assert.notEqual(fresh.archivedAt, null, "no debe haberse restaurado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: events.map((e) => e.id), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});
