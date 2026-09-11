import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    createEventService,
    syncEventScheduleService,
    updateMyEventService,
    getMyEventByIdService,
} from "../src/services/event.service.js";
import { createSaleForBuyer } from "../src/services/sale.service.js";

// Ronda "sincronización incremental" — reemplaza el reemplazo destructivo
// global (deleteMany + recreate) de syncEventScheduleService por UPDATE
// in-place / CREATE / DELETE-sólo-sin-historial. Suite SCHEDULE-SAFE-01 a
// 16, exactamente la matriz pedida en el informe de diseño de la ronda
// anterior.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

function locationInput(overrides = {}) {
    return { venueName: "Plaza Central", formattedAddress: "Calle Falsa 123", latitude: -33.12, longitude: -64.34, ...overrides };
}

async function createGuestBuyer() {
    const suffix = uniqueSuffix();
    return prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", lastName: "Test" } });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Crea un evento TICKETED, publicado, con 1 función y 1 TicketType (100 de
// cupo), y devuelve los ids reales ya persistidos — punto de partida común
// para casi toda la suite.
async function createPublishedEventWithSchedule(owner, org, title, { quantity = 100 } = {}) {
    const draft = await createEventService(owner.clerkId, { title, admissionType: "TICKETED", location: locationInput() }, org.id);
    await syncEventScheduleService(owner.clerkId, draft.id, {
        // maxPerPurchase alto a propósito: algunos tests de esta suite
        // compran de a 30 unidades en una sola Sale para simular "ya
        // comprometido" — el límite real de compra por transacción
        // (maxPerPurchase) es una regla de negocio distinta, no lo que este
        // fixture necesita ejercitar.
        ticketTypes: [{ name: "General", price: 10000, quantity, maxPerPurchase: 999 }],
        functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
    });
    await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
    const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
    return { event: draft, functionId: loaded.functions[0].id, ticketTypeId: loaded.ticketTypes[0].id };
}

async function buySale(draft, functionId, ticketTypeId, quantity = 1) {
    const buyer = await createGuestBuyer();
    return createSaleForBuyer(
        buyer,
        { eventId: draft.id, functionId, items: [{ ticketTypeId, quantity }], buyerDocument: "30111222" },
        { origin: "SALE" }
    );
}

// SCHEDULE-SAFE-01: editar fecha/hora/lugar de una función CON ventas.
testWithDb("SCHEDULE-SAFE-01: editar fecha/lugar de una función con ventas conserva el mismo id", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-01");
    try {
        await buySale(event, functionId, ticketTypeId);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
            functions: [{ id: functionId, date: "2099-09-01T21:00:00-03:00", endAt: "2099-09-02T01:00:00-03:00", venue: "Teatro Nuevo", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(updated.functions[0].id, functionId);
        assert.equal(updated.functions[0].venue, "Teatro Nuevo");
        assert.equal(new Date(updated.functions[0].date).toISOString(), new Date("2099-09-01T21:00:00-03:00").toISOString());
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-02: editar precio de TicketType CON ventas — SaleItem
// histórica conserva el precio viejo (snapshot).
testWithDb("SCHEDULE-SAFE-02: editar precio con ventas conserva id y el snapshot histórico de SaleItem", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-02");
    try {
        const sale = await buySale(event, functionId, ticketTypeId);
        const saleItemBefore = await prisma.saleItem.findFirst({ where: { saleId: sale.id } });
        assert.equal(Number(saleItemBefore.unitPrice), 10000);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 15000, quantity: 100 }],
            functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(updated.ticketTypes[0].id, ticketTypeId);
        assert.equal(Number(updated.ticketTypes[0].price), 15000);

        const saleItemAfter = await prisma.saleItem.findFirst({ where: { saleId: sale.id } });
        assert.equal(Number(saleItemAfter.unitPrice), 10000, "SaleItem.unitPrice es un snapshot — nunca cambia con el precio actual del catálogo");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-03: agregar función nueva a evento CON ventas.
testWithDb("SCHEDULE-SAFE-03: agregar función nueva conserva la existente y crea una con otro id", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-03");
    try {
        await buySale(event, functionId, ticketTypeId);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
            functions: [
                { id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] },
                { date: "2099-08-26T20:00:00-03:00", endAt: "2099-08-26T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] },
            ],
        });
        assert.equal(updated.functions.length, 2);
        const ids = updated.functions.map((f) => f.id);
        assert.ok(ids.includes(functionId), "la función original conserva su id");
        assert.equal(new Set(ids).size, 2, "la función nueva tiene un id distinto");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-04: agregar TicketType nuevo a evento CON ventas.
testWithDb("SCHEDULE-SAFE-04: agregar TicketType nuevo funciona junto al existente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-04");
    try {
        await buySale(event, functionId, ticketTypeId);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [
                { id: ticketTypeId, name: "General", price: 10000, quantity: 100 },
                { name: "VIP", price: 20000, quantity: 20 },
            ],
            functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }, { enabled: true }] }],
        });
        assert.equal(updated.ticketTypes.length, 2);
        const ids = updated.ticketTypes.map((t) => t.id);
        assert.ok(ids.includes(ticketTypeId));
        assert.equal(new Set(ids).size, 2);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-05: eliminar función SIN ventas se permite.
testWithDb("SCHEDULE-SAFE-05: eliminar una función sin ventas la borra físicamente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-05", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
            functions: [
                { date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A" },
                { date: "2099-08-26T20:00:00-03:00", endAt: "2099-08-26T23:00:00-03:00", venue: "Función B" },
            ],
        });
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const [fnA, fnB] = loaded.functions;
        const ticketTypeId = loaded.ticketTypes[0].id;

        const updated = await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
            functions: [{ id: fnA.id, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A" }],
        });
        assert.equal(updated.functions.length, 1);
        assert.equal(updated.functions[0].id, fnA.id);

        const deleted = await prisma.eventFunction.findUnique({ where: { id: fnB.id } });
        assert.equal(deleted, null, "la función sin ventas debe haberse borrado físicamente");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-06: eliminar función CON ventas rechaza y hace rollback.
testWithDb("SCHEDULE-SAFE-06: eliminar una función con ventas rechaza con SCHEDULE_FUNCTION_HAS_SALES y no deja nada a medias", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-06", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
            functions: [
                { date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A" },
                { date: "2099-08-26T20:00:00-03:00", endAt: "2099-08-26T23:00:00-03:00", venue: "Función B" },
            ],
        });
        await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const [fnA, fnB] = loaded.functions;
        const ticketTypeId = loaded.ticketTypes[0].id;
        await buySale(draft, fnB.id, ticketTypeId);

        await assert.rejects(
            syncEventScheduleService(owner.clerkId, draft.id, {
                ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
                functions: [{ id: fnA.id, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A editada" }],
            }),
            (error) => {
                assert.equal(error.message, "SCHEDULE_FUNCTION_HAS_SALES");
                return true;
            }
        );

        // Rollback completo: NI la función A (edición válida) quedó
        // aplicada, NI la B (con ventas) fue tocada.
        const stillA = await prisma.eventFunction.findUnique({ where: { id: fnA.id } });
        assert.equal(stillA.venue, "Función A", "la edición válida de A tampoco debe haber quedado persistida");
        const stillB = await prisma.eventFunction.findUnique({ where: { id: fnB.id } });
        assert.ok(stillB, "la función B con ventas debe seguir existiendo");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-07: eliminar TicketType SIN ventas.
testWithDb("SCHEDULE-SAFE-07: eliminar un TicketType sin ventas lo borra físicamente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-07", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [
                { name: "General", price: 10000, quantity: 100 },
                { name: "VIP", price: 20000, quantity: 20 },
            ],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }, { enabled: true }] }],
        });
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const [general, vip] = loaded.ticketTypes;
        const fnId = loaded.functions[0].id;

        const updated = await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ id: general.id, name: "General", price: 10000, quantity: 100 }],
            functions: [{ id: fnId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(updated.ticketTypes.length, 1);

        const deleted = await prisma.ticketType.findUnique({ where: { id: vip.id } });
        assert.equal(deleted, null);
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-08: eliminar TicketType CON ventas rechaza y hace rollback.
testWithDb("SCHEDULE-SAFE-08: eliminar un TicketType con ventas rechaza con TICKET_TYPE_HAS_SALES y no deja nada a medias", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-08", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [
                { name: "General", price: 10000, quantity: 100 },
                { name: "VIP", price: 20000, quantity: 20 },
            ],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }, { enabled: true }] }],
        });
        await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const [general, vip] = loaded.ticketTypes;
        const fnId = loaded.functions[0].id;
        await buySale(draft, fnId, vip.id);

        await assert.rejects(
            syncEventScheduleService(owner.clerkId, draft.id, {
                ticketTypes: [{ id: general.id, name: "General editado", price: 10000, quantity: 100 }],
                functions: [{ id: fnId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
            }),
            (error) => {
                assert.equal(error.message, "TICKET_TYPE_HAS_SALES");
                return true;
            }
        );

        const stillGeneral = await prisma.ticketType.findUnique({ where: { id: general.id } });
        assert.equal(stillGeneral.name, "General", "la edición válida de General tampoco debe haber quedado persistida");
        const stillVip = await prisma.ticketType.findUnique({ where: { id: vip.id } });
        assert.ok(stillVip, "VIP (con ventas) debe seguir existiendo");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-09: bajar capacidad por debajo de lo comprometido (vendido
// + reservado PENDING vigente) rechaza.
testWithDb("SCHEDULE-SAFE-09: bajar quantity por debajo de lo vendido+reservado rechaza con TICKET_STOCK_BELOW_COMMITTED", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-09", { quantity: 100 });
    try {
        // 30 vendidos (ACTIVE vía Sale) + 10 reservados (Sale PENDING vigente).
        await buySale(event, functionId, ticketTypeId, 30);
        await buySale(event, functionId, ticketTypeId, 10);
        // Ambas quedan PENDING (createSaleForBuyer nunca confirma solo) —
        // exactamente el escenario "reservado vigente" del enunciado.

        await assert.rejects(
            syncEventScheduleService(owner.clerkId, event.id, {
                ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 35 }],
                functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
            }),
            (error) => {
                assert.equal(error.message, "TICKET_STOCK_BELOW_COMMITTED");
                assert.equal(error.committed, 40, "30 + 10 reservados vigentes");
                return true;
            }
        );
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-10: bajar capacidad pero mantenerse >= lo comprometido.
testWithDb("SCHEDULE-SAFE-10: bajar quantity manteniéndose >= lo comprometido se permite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-10", { quantity: 100 });
    try {
        await buySale(event, functionId, ticketTypeId, 30);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 50 }],
            functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(Number(updated.ticketTypes[0].quantity), 50);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-11: subir capacidad siempre se permite.
testWithDb("SCHEDULE-SAFE-11: subir quantity siempre se permite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, functionId, ticketTypeId } = await createPublishedEventWithSchedule(owner, org, "SAFE-11", { quantity: 100 });
    try {
        await buySale(event, functionId, ticketTypeId, 30);

        const updated = await syncEventScheduleService(owner.clerkId, event.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 200 }],
            functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(Number(updated.ticketTypes[0].quantity), 200);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-12/13: un id de OTRO evento nunca puede colarse.
testWithDb("SCHEDULE-SAFE-12: un EventFunction.id de otro evento rechaza con SCHEDULE_FUNCTION_NOT_FOUND y no toca el otro evento", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event: eventA, functionId: functionIdA } = await createPublishedEventWithSchedule(owner, org, "SAFE-12-A");
    const { event: eventB } = await createPublishedEventWithSchedule(owner, org, "SAFE-12-B");
    try {
        await assert.rejects(
            syncEventScheduleService(owner.clerkId, eventB.id, {
                ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
                functions: [{ id: functionIdA, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Intento cruzado" }],
            }),
            (error) => {
                assert.equal(error.message, "SCHEDULE_FUNCTION_NOT_FOUND");
                return true;
            }
        );

        const untouched = await prisma.eventFunction.findUnique({ where: { id: functionIdA } });
        assert.equal(untouched.venue, "Plaza Central", "la función del evento A nunca debe haberse tocado desde B");
    } finally {
        await cleanup({ eventIds: [eventA.id, eventB.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("SCHEDULE-SAFE-13: un TicketType.id de otro evento rechaza con TICKET_TYPE_NOT_FOUND y no toca el otro evento", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event: eventA, ticketTypeId: ticketTypeIdA } = await createPublishedEventWithSchedule(owner, org, "SAFE-13-A");
    const { event: eventB } = await createPublishedEventWithSchedule(owner, org, "SAFE-13-B");
    try {
        await assert.rejects(
            syncEventScheduleService(owner.clerkId, eventB.id, {
                ticketTypes: [{ id: ticketTypeIdA, name: "Intento cruzado", price: 10000, quantity: 100 }],
                functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central" }],
            }),
            (error) => {
                assert.equal(error.message, "TICKET_TYPE_NOT_FOUND");
                return true;
            }
        );

        const untouched = await prisma.ticketType.findUnique({ where: { id: ticketTypeIdA } });
        assert.equal(untouched.name, "General", "el TicketType del evento A nunca debe haberse tocado desde B");
    } finally {
        await cleanup({ eventIds: [eventA.id, eventB.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-14: rollback atómico — un cambio válido + uno inválido en
// la MISMA sincronización -> ninguno persiste.
testWithDb("SCHEDULE-SAFE-14: un cambio inválido en la sincronización revierte también los cambios válidos del mismo guardado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-14", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
            functions: [
                { date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A" },
                { date: "2099-08-26T20:00:00-03:00", endAt: "2099-08-26T23:00:00-03:00", venue: "Función B" },
            ],
        });
        await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const [fnA, fnB] = loaded.functions;
        const ticketTypeId = loaded.ticketTypes[0].id;
        await buySale(draft, fnB.id, ticketTypeId);

        // Cambio válido: A cambia de lugar. Cambio inválido en el MISMO
        // guardado: B (con ventas) desaparece del payload -> se intenta
        // eliminar.
        await assert.rejects(
            syncEventScheduleService(owner.clerkId, draft.id, {
                ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
                functions: [{ id: fnA.id, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Función A EDITADA" }],
            }),
            (error) => {
                assert.equal(error.message, "SCHEDULE_FUNCTION_HAS_SALES");
                return true;
            }
        );

        const stillA = await prisma.eventFunction.findUnique({ where: { id: fnA.id } });
        assert.equal(stillA.venue, "Función A", "el cambio válido de A NO debe haber quedado persistido — rollback completo");
        const stillB = await prisma.eventFunction.findUnique({ where: { id: fnB.id } });
        assert.ok(stillB, "B debe seguir existiendo, intacta");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-15: legacy futura endAt=null -> completar endAt -> PASS
// (reconfirmación explícita con el mecanismo NUEVO, ya cubierto también en
// scheduleLegacyCompat.test.js con el mecanismo viejo de creación).
testWithDb("SCHEDULE-SAFE-15: función legacy futura sin endAt se puede completar vía UPDATE in-place", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-15", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }],
        });
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const fnId = loaded.functions[0].id;
        assert.equal(loaded.functions[0].endAt, null);

        const updated = await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ id: loaded.ticketTypes[0].id, name: "General", price: 10000, quantity: 100 }],
            functions: [{ id: fnId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central" }],
        });
        assert.equal(updated.functions[0].id, fnId, "mismo id — UPDATE in-place, no recreación");
        assert.ok(updated.functions[0].endAt, "endAt ya debe estar completo");

        const published = await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        assert.equal(published.status, "PUBLISHED");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-SAFE-16: evento/función ya finalizada sigue protegida — no puede
// "revivirse" reprogramándola vía este mecanismo nuevo (assertFunctionActive
// reusado, misma regla central que sale.service.js/scanner.service.js).
testWithDb("SCHEDULE-SAFE-16: una función ya finalizada no puede reprogramarse (assertFunctionActive)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SAFE-16", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 100 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central" }],
        });
        await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        const fnId = loaded.functions[0].id;
        const ticketTypeId = loaded.ticketTypes[0].id;

        // El reloj "avanza": la función ya terminó.
        await prisma.eventFunction.update({ where: { id: fnId }, data: { endAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

        await assert.rejects(
            syncEventScheduleService(owner.clerkId, draft.id, {
                ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 100 }],
                functions: [{ id: fnId, date: "2099-12-25T20:00:00-03:00", endAt: "2099-12-25T23:00:00-03:00", venue: "Intento de revivir" }],
            }),
            (error) => {
                assert.equal(error.code, "EVENT_FINISHED");
                return true;
            }
        );

        const stillFinished = await prisma.eventFunction.findUnique({ where: { id: fnId } });
        assert.equal(stillFinished.venue, "Plaza Central", "el intento de reprogramar una función finalizada no debe haber quedado aplicado");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
