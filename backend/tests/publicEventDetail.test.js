import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getPublicEventBySlugService } from "../src/services/event.service.js";

// GET /api/events/public/:slug (getPublicEventBySlugService) — ronda
// "optimización de performance" (auditoría de lectura, ver informe): 2
// índices de Ticket/EventFunction/TicketType/EventLink nuevos (migration
// 20260903150000_optimize_public_event_queries, sólo CREATE INDEX, cero
// cambio semántico) + reducción de payload (ticketAssignments ya no anida
// el TicketType completo, sólo ticketTypeId — el cliente lo cruza contra
// event.ticketTypes). Este archivo cubre que el comportamiento observable
// del endpoint (disponibilidad, capacidad, shape) es EXACTAMENTE el mismo
// de antes, con el shape reducido. CRUD real contra Postgres real
// (backend/.env.test) — mismo criterio/helpers que featuredOrganizations.test.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
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

async function createEvent(org, owner, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.event.create({
        data: {
            title: `Evento ${suffix}`,
            slug: `evento-${suffix}`,
            createdBy: owner.id,
            organizationId: org.id,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            ...overrides,
        },
    });
}

async function createFunction(event, overrides = {}) {
    return prisma.eventFunction.create({
        data: {
            eventId: event.id,
            date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            venue: "Sala principal",
            status: "SCHEDULED",
            ...overrides,
        },
    });
}

async function createTicketType(event, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.ticketType.create({
        data: {
            eventId: event.id,
            name: `General ${suffix}`,
            price: 1000,
            quantity: 100,
            ...overrides,
        },
    });
}

async function assignTicketType(fn, ticketType, overrides = {}) {
    return prisma.functionTicketType.create({
        data: { functionId: fn.id, ticketTypeId: ticketType.id, enabled: true, ...overrides },
    });
}

async function createSoldTicket(event, fn, ticketType, buyer, overrides = {}) {
    const sale = await prisma.sale.create({
        data: {
            status: "CONFIRMED",
            paymentMethod: "MANUAL",
            origin: "SALE",
            total: 1000,
            buyerId: buyer.id,
            eventId: event.id,
            functionId: fn.id,
        },
    });
    return prisma.ticket.create({
        data: {
            ticketNumber: `PC-TEST-${uniqueSuffix()}`,
            status: "ACTIVE",
            origin: "SALE",
            saleId: sale.id,
            eventId: event.id,
            functionId: fn.id,
            ticketTypeId: ticketType.id,
            buyerId: buyer.id,
            ownerId: buyer.id,
            ...overrides,
        },
    });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    const cleanEventIds = eventIds.filter(Boolean);
    const cleanOrgIds = organizationIds.filter(Boolean);
    const cleanUserIds = userIds.filter(Boolean);
    if (cleanEventIds.length) {
        await prisma.ticket.deleteMany({ where: { eventId: { in: cleanEventIds } } });
        await prisma.sale.deleteMany({ where: { eventId: { in: cleanEventIds } } });
        await prisma.event.deleteMany({ where: { id: { in: cleanEventIds } } });
    }
    if (cleanOrgIds.length) await prisma.organization.deleteMany({ where: { id: { in: cleanOrgIds } } });
    if (cleanUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanUserIds } } });
}

testWithDb("PUBLIC-EVENT-A: responde con evento, función y tipo de entrada", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event);
        await assignTicketType(fn, ticketType);

        const result = await getPublicEventBySlugService(event.slug);

        assert.ok(result);
        assert.equal(result.id, event.id);
        assert.equal(result.functions.length, 1);
        assert.equal(result.functions[0].id, fn.id);
        assert.equal(result.ticketTypes.length, 1);
        assert.equal(result.ticketTypes[0].id, ticketType.id);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-B: evento sin tickets (FREE_ENTRY, sin funciones) funciona", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner, { admissionType: "FREE_ENTRY" });

        const result = await getPublicEventBySlugService(event.slug);

        assert.ok(result);
        assert.deepEqual(result.functions, []);
        assert.deepEqual(result.ticketTypes, []);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-C: evento con múltiples funciones trae cada una con sus propias asignaciones", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn1 = await createFunction(event, { date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) });
        const fn2 = await createFunction(event, { date: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000) });
        const ticketType = await createTicketType(event, { quantity: 10 });
        await assignTicketType(fn1, ticketType);
        await assignTicketType(fn2, ticketType);

        const result = await getPublicEventBySlugService(event.slug);

        assert.equal(result.functions.length, 2);
        const functionIds = result.functions.map((f) => f.id).sort();
        assert.deepEqual(functionIds, [fn1.id, fn2.id].sort());
        for (const fn of result.functions) {
            assert.equal(fn.ticketAssignments.length, 1);
        }
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-D: disponibilidad se calcula igual que antes — sólo ACTIVE/USED restan stock, CANCELLED/REFUNDED no", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event, { quantity: 10 });
        await assignTicketType(fn, ticketType);

        // 2 ACTIVE + 1 USED cuentan como ocupados; 1 CANCELLED y 1 REFUNDED no.
        await createSoldTicket(event, fn, ticketType, buyer, { status: "ACTIVE" });
        await createSoldTicket(event, fn, ticketType, buyer, { status: "ACTIVE" });
        await createSoldTicket(event, fn, ticketType, buyer, { status: "USED" });
        await createSoldTicket(event, fn, ticketType, buyer, { status: "CANCELLED" });
        await createSoldTicket(event, fn, ticketType, buyer, { status: "REFUNDED" });

        const result = await getPublicEventBySlugService(event.slug);
        const assignment = result.functions[0].ticketAssignments[0];

        // capacity 10, sólo 3 ocupan stock (ACTIVE x2 + USED x1) -> available 7.
        assert.equal(assignment.available, 7);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("PUBLIC-EVENT-E: capacidad respeta quantityOverride sobre la cantidad del catálogo", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event, { quantity: 100 });
        await assignTicketType(fn, ticketType, { quantityOverride: 5 });

        const result = await getPublicEventBySlugService(event.slug);
        const assignment = result.functions[0].ticketAssignments[0];

        assert.equal(assignment.available, 5);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-F: el payload ya no duplica el TicketType completo dentro de ticketAssignments", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event);
        await assignTicketType(fn, ticketType);

        const result = await getPublicEventBySlugService(event.slug);
        const assignment = result.functions[0].ticketAssignments[0];

        // Shape reducido: sólo ticketTypeId, nunca un objeto ticketType anidado.
        assert.equal(assignment.ticketTypeId, ticketType.id);
        assert.equal(assignment.ticketType, undefined);
        assert.equal(Object.prototype.hasOwnProperty.call(assignment, "ticketType"), false);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-G: un cliente puede reconstruir el TicketType completo cruzando ticketTypeId contra event.ticketTypes", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event, { name: "VIP", price: 5000 });
        await assignTicketType(fn, ticketType);

        const result = await getPublicEventBySlugService(event.slug);
        const assignment = result.functions[0].ticketAssignments[0];

        const resolved = result.ticketTypes.find((tt) => tt.id === assignment.ticketTypeId);
        assert.ok(resolved);
        assert.equal(resolved.name, "VIP");
        assert.equal(Number(resolved.price), 5000);
        assert.equal(resolved.quantity, 100);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUBLIC-EVENT-H: una asignación deshabilitada (enabled:false) nunca se expone al público", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id);
        event = await createEvent(org, owner);
        const fn = await createFunction(event);
        const ticketType = await createTicketType(event);
        await assignTicketType(fn, ticketType, { enabled: false });

        const result = await getPublicEventBySlugService(event.slug);

        assert.equal(result.functions[0].ticketAssignments.length, 0);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});
