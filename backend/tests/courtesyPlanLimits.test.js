import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService, syncEventScheduleService } from "../src/services/event.service.js";
import { issueCourtesyService, cancelCourtesyService } from "../src/services/courtesy.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";

// Premium — Fase 2B. Enforcement real de maxCourtesiesPerEvent (cuenta
// TICKETS históricos con origin=COURTESY para el evento, sin filtrar por
// status — cancelar/usar NUNCA devuelve cupo). El guard vive dentro de la
// MISMA transacción de confirmSaleService que crea los Ticket (ver
// sale.service.js) — se prueba contra Postgres real (backend/.env.test),
// nunca con mocks de Prisma. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
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

// TICKETED con stock amplio (1000): las cortesías reutilizan EXACTAMENTE el
// mismo pipeline que una venta real (createSaleForBuyer + confirmSaleService,
// ver courtesy.service.js) — necesitan un TicketType/Function reales, a
// diferencia de los tests de eventPlanLimits.test.js que usan FREE_ENTRY
// (courtesías nunca pueden emitirse sobre FREE_ENTRY, createSaleForBuyer lo
// rechaza con EVENT_FREE_ENTRY_NO_SALES).
async function createTicketedEvent(owner, org, title, ticketQuantity = 1000) {
    const event = await createEventService(owner.clerkId, { title, location: locationInput() }, org.id);
    return syncEventScheduleService(
        owner.clerkId,
        event.id,
        {
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }],
            ticketTypes: [{ name: "General", price: 1000, quantity: ticketQuantity }],
        },
        org.id
    );
}

// deliveryMethod: "SHARE" siempre — evita que getOrCreateCourtesyRecipient
// cree un User adicional por email (buyer = issuer, ver courtesy.service.js),
// así el cleanup de este archivo sólo necesita trackear owner/developer.
function issueCourtesy(clerkId, event, quantity, overrides = {}) {
    return issueCourtesyService(clerkId, {
        eventId: event.id,
        functionId: event.functions[0].id,
        ticketTypeId: event.ticketTypes[0].id,
        quantity,
        deliveryMethod: "SHARE",
        ...overrides,
    });
}

async function courtesyTicketCount(eventId) {
    return prisma.ticket.count({ where: { eventId, origin: "COURTESY" } });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.courtesyIssuance.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticketAuditLog.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
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

testWithDb("CO-A: null (sin límite configurado) permite emitir cortesías", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: null });
        event = await createTicketedEvent(owner, org, "CO-A");
        const result = await issueCourtesy(owner.clerkId, event, 1);
        assert.ok(result.sale.id);
        assert.equal(await courtesyTicketCount(event.id), 1);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-B: 0 bloquea toda emisión nueva", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 0 });
        event = await createTicketedEvent(owner, org, "CO-B");

        await assert.rejects(
            () => issueCourtesy(owner.clerkId, event, 1),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 0);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-C: debajo del límite permite emitir", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 5 });
        event = await createTicketedEvent(owner, org, "CO-C");
        await issueCourtesy(owner.clerkId, event, 1);
        await issueCourtesy(owner.clerkId, event, 1);
        assert.equal(await courtesyTicketCount(event.id), 2);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-D: límite alcanzado bloquea la siguiente emisión", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 2 });
        event = await createTicketedEvent(owner, org, "CO-D");
        await issueCourtesy(owner.clerkId, event, 2);

        await assert.rejects(
            () => issueCourtesy(owner.clerkId, event, 1),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 2);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-E: una emisión de múltiples tickets consume múltiples unidades", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 10 });
        event = await createTicketedEvent(owner, org, "CO-E");
        await issueCourtesy(owner.clerkId, event, 4);
        assert.equal(await courtesyTicketCount(event.id), 4);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-F: si historical + requested excede el remanente, se bloquea toda la emisión (nunca parcial)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 10 });
        event = await createTicketedEvent(owner, org, "CO-F");
        await issueCourtesy(owner.clerkId, event, 8); // 8/10, remanente 2

        await assert.rejects(
            () => issueCourtesy(owner.clerkId, event, 3),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 8, "la emisión rechazada no debe haber creado ningún ticket, ni siquiera parcial");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-G: una cortesía cancelada sigue consumiendo cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 1 });
        event = await createTicketedEvent(owner, org, "CO-G");
        const issued = await issueCourtesy(owner.clerkId, event, 1);

        await cancelCourtesyService(owner.clerkId, issued.sale.id);
        const cancelledTicket = await prisma.ticket.findFirst({ where: { saleId: issued.sale.id } });
        assert.equal(cancelledTicket.status, "CANCELLED");

        await assert.rejects(
            () => issueCourtesy(owner.clerkId, event, 1),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 1, "cancelar no debe haber liberado cupo");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-H: una cortesía usada (Ticket USED) sigue consumiendo cupo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 1 });
        event = await createTicketedEvent(owner, org, "CO-H");
        const issued = await issueCourtesy(owner.clerkId, event, 1);
        await prisma.ticket.updateMany({ where: { saleId: issued.sale.id }, data: { status: "USED" } });

        await assert.rejects(
            () => issueCourtesy(owner.clerkId, event, 1),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 1);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-I: el Event A no cuenta cortesías del Event B", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let eventA, eventB;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 1 });
        eventA = await createTicketedEvent(owner, org, "CO-I-A");
        eventB = await createTicketedEvent(owner, org, "CO-I-B");

        await issueCourtesy(owner.clerkId, eventA, 1); // A queda 1/1

        const resultB = await issueCourtesy(owner.clerkId, eventB, 1);
        assert.ok(resultB.sale.id, "el Event B tiene su propio cupo independiente del Event A");
        assert.equal(await courtesyTicketCount(eventB.id), 1);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: [eventA?.id, eventB?.id].filter(Boolean), organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-J: DEVELOPER emitiendo para otra Organization usa el plan de la Organization propietaria del evento", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id); // FREE por default
    const developer = await createUser({ role: "DEVELOPER" }); // sin Organization propia
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        // PREMIUM sin límite, FREE con límite 1 — si el guard usara el plan
        // equivocado (o un default), esto no bloquearía la segunda emisión.
        await updatePlanLimitsService("PREMIUM", developer.id, { maxCourtesiesPerEvent: null });
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 1 });

        event = await createTicketedEvent(owner, org, "CO-J");
        await issueCourtesy(developer.clerkId, event, 1); // developer emite para la org de owner (bypass de ownership)

        await assert.rejects(
            () => issueCourtesy(developer.clerkId, event, 1),
            (error) => {
                assert.equal(error.code, "PLAN_COURTESY_LIMIT_REACHED");
                return true;
            }
        );
        assert.equal(await courtesyTicketCount(event.id), 1, "debe haber usado el límite FREE de la Organization dueña del evento, no un default ilimitado");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CO-K: emisiones simultáneas no pueden superar el límite (concurrencia)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 1 });
        event = await createTicketedEvent(owner, org, "CO-K");

        const results = await Promise.allSettled([issueCourtesy(owner.clerkId, event, 1), issueCourtesy(owner.clerkId, event, 1)]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "sólo una de las dos emisiones concurrentes debe ganar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, "PLAN_COURTESY_LIMIT_REACHED");

        // Conteo REAL en la base — no alcanza con que una Promise haya sido
        // rechazada, tiene que verse reflejado en Ticket.origin=COURTESY.
        const finalCount = await courtesyTicketCount(event.id);
        assert.equal(finalCount, 1, "el conteo real de tickets de cortesía nunca debe superar el límite");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});
