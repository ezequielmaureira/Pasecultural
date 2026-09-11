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
import { isFunctionFinished } from "../src/services/eventArchive.service.js";

// Ronda "Fest Pass create bug + Fiesta Nueva schedule error" — 2 regresiones
// encontradas al investigar un reporte real de producción:
//
// 1) Hipótesis original (endAt=null legacy) resultó FALSA para el caso real
//    reportado (Fiesta Nueva ya tenía endAt cargado) — pero la suite
//    LEGACY-01/02/03/05 de acá abajo sigue siendo cobertura válida y nueva
//    para el escenario legítimo que la ronda EVENT_FINISHED_GUARD dejó sin
//    probar explícitamente: una EventFunction vieja con endAt=null, en un
//    evento FUTURO (nunca finalizado), que el Organizer tiene que poder
//    seguir editando y completar.
// 2) Causa REAL de "Error al guardar la programación del evento" en
//    Fiesta Nueva: syncEventScheduleService borra y recrea TODAS las
//    EventFunction/TicketType del evento en cada guardado de agenda — pero
//    si alguna ya tiene una Sale o un Ticket real (sales_functionId_fkey/
//    tickets_functionId_fkey, RESTRICT nunca CASCADE — mismo criterio ya
//    usado en deleteMyEventService), ese DELETE es rechazado por Postgres
//    (P2003) y el error crudo escalaba hasta el 500 genérico del
//    controller. Cubierto acá como SCHEDULE-01/02.
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

// LEGACY-01: un evento FUTURO (nunca finalizado) con una función SIN endAt
// (simulando datos anteriores a la regla EVENT_FUNCTION_END_REQUIRED) puede
// cargarse normalmente para edición — nunca rompe getMyEventByIdService.
testWithDb("LEGACY-01: evento futuro con función legacy endAt=null puede cargarse para edición", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "LEGACY-01", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        // endAt deliberadamente ausente — mismo shape que un dato viejo,
        // anterior a la obligatoriedad.
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });

        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        assert.equal(loaded.functions.length, 1);
        assert.equal(loaded.functions[0].endAt, null, "el dato legacy se carga tal cual, nunca se inventa un valor");
        assert.equal(isFunctionFinished(loaded.functions[0]), false, "sin endAt cae al fallback (fin del día de `date`, 2099) — sigue siendo futura");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// LEGACY-02: publicar sin completar la hora de fin devuelve
// EVENT_FUNCTION_END_REQUIRED (mensaje específico, no un error genérico) —
// mismo comportamiento ya validado en EF-06 (eventFinishedGuard.test.js),
// reconfirmado acá desde el ángulo "evento legacy real".
testWithDb("LEGACY-02: publicar sin hora de fin devuelve EVENT_FUNCTION_END_REQUIRED", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "LEGACY-02", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });

        await assert.rejects(
            updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id),
            (error) => {
                assert.equal(error.message, "EVENT_FUNCTION_END_REQUIRED");
                return true;
            }
        );
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// LEGACY-03: completar la hora de fin permite publicar normalmente.
testWithDb("LEGACY-03: completar la hora de fin permite guardar y publicar normalmente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "LEGACY-03", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        // El Organizer completa la hora de fin (re-guarda la agenda con
        // endAt) — el evento TODAVÍA no tiene ventas, así que el guard
        // nuevo de SCHEDULE_HAS_SALES no aplica acá.
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });

        const published = await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        assert.equal(published.status, "PUBLISHED");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// LEGACY-05: un evento futuro NO se considera finalizado sólo por ser
// legacy (endAt=null) — el fallback (fin del día de `date`) nunca lo marca
// finalizado si `date` en sí es futura.
test("LEGACY-05: isFunctionFinished nunca marca finalizada una función futura, tenga o no endAt", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    assert.equal(isFunctionFinished({ date: future, endAt: null, doorsOpenAt: null }), false);
    assert.equal(isFunctionFinished({ date: future, endAt: new Date(future.getTime() + 3 * 60 * 60 * 1000), doorsOpenAt: null }), false);
});

// SCHEDULE-01 (actualizado — ronda "sincronización incremental") — LA
// CAUSA REAL de "Error al guardar la programación del evento" en Fiesta
// Nueva era el reemplazo destructivo global; ahora que syncEventScheduleService
// sincroniza de forma incremental (UPDATE in-place cuando el payload manda
// el `id` real), reprogramar una función CON ventas reales YA FUNCIONA —
// cobertura exhaustiva de esto en scheduleSafeSync.test.js. Acá queda sólo
// la reconfirmación puntual de que el caso real de Fiesta Nueva (cambiar el
// lugar de una función con una Sale) pasa a funcionar.
testWithDb("SCHEDULE-01: reprogramar (con id) una función con una Sale existente ahora funciona, conservando el id", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SCHEDULE-01", admissionType: "TICKETED", location: locationInput() }, org.id);
    let functionId;
    let ticketTypeId;
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);

        const loaded = await getMyEventByIdService(owner.clerkId, draft.id, org.id);
        functionId = loaded.functions[0].id;
        ticketTypeId = loaded.ticketTypes[0].id;

        const buyer = await createGuestBuyer();
        await createSaleForBuyer(
            buyer,
            { eventId: draft.id, functionId, items: [{ ticketTypeId, quantity: 1 }], buyerDocument: "30111222" },
            { origin: "SALE" }
        );

        // El organizador reprograma (cambia el lugar) mandando el `id` real
        // de la función — la función YA tiene una Sale real (aunque siga
        // PENDING, RESTRICT no distingue estado) y aun así debe poder
        // editarse, conservando el mismo id.
        const updated = await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ id: ticketTypeId, name: "General", price: 10000, quantity: 50 }],
            functions: [{ id: functionId, date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Otro lugar", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(updated.functions[0].id, functionId, "el id de la función debe conservarse");
        assert.equal(updated.functions[0].venue, "Otro lugar");

        // La Sale original sigue apuntando exactamente a la misma función.
        const saleStillLinked = await prisma.sale.findFirst({ where: { functionId } });
        assert.ok(saleStillLinked, "la Sale debe seguir existiendo y apuntando al mismo functionId");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// SCHEDULE-02: sin ninguna venta todavía, reprogramar sigue funcionando
// exactamente igual que siempre (comportamiento normal preservado).
testWithDb("SCHEDULE-02: reprogramar un evento SIN ventas sigue funcionando normalmente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createEventService(owner.clerkId, { title: "SCHEDULE-02", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        });
        const updated = await syncEventScheduleService(owner.clerkId, draft.id, {
            ticketTypes: [{ name: "General", price: 12000, quantity: 60 }],
            functions: [{ date: "2099-08-26T20:00:00-03:00", endAt: "2099-08-26T23:00:00-03:00", venue: "Otro lugar", ticketAssignments: [{ enabled: true }] }],
        });
        assert.equal(updated.functions[0].venue, "Otro lugar");
        assert.equal(Number(updated.ticketTypes[0].price), 12000);
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
