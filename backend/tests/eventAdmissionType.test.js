import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService, syncEventScheduleService, updateMyEventService } from "../src/services/event.service.js";
import { createSaleForBuyer } from "../src/services/sale.service.js";
import { commit } from "../src/conversation/EventServicePort.js";
import { setPublicLaunchEnabledService } from "../src/services/publicLaunchSettings.service.js";

// Eventos gratuitos (FREE_ENTRY) — primera versión funcional. CRUD +
// transacciones reales (Event/EventFunction/TicketType/Sale), no expresable
// como funciones puras: se prueba contra Postgres real (backend/.env.test),
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

// Mismo shape que eventServicePort.commit.perf.test.js#buildDraft — archivo
// distinto, fixture propia (cada test file de este repo define la suya,
// nunca una compartida), sólo que ahora acepta también `admissionType`
// (inexistente en el draft real hasta esta ronda: lo escriben
// EVENT_PRICING_TYPE/WANTS_FREE_TICKETS en steps/definitions.js).
function buildDraft(overrides = {}) {
    return {
        title: "Fiesta de Prueba",
        description: "Descripción de prueba",
        category: "MUSICA",
        coverImage: null,
        location: {
            venueName: "Club de Prueba",
            address: "Calle Falsa 123",
            city: "Río Cuarto",
            province: "Córdoba",
            latitude: -33.12,
            longitude: -64.34,
            googlePlaceId: null,
        },
        functions: [{ date: "2099-08-25", startTime: "20:00", endTime: "23:00" }],
        hasTickets: true,
        ticketTypes: [{ name: "General", price: 20000, quantity: 100 }],
        ...overrides,
    };
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

// Modo Prelanzamiento (ronda posterior a FREE_ENTRY) — createSaleForBuyer
// ahora también bloquea origin=SALE (default) cuando publicLaunchEnabled
// es false (ver sale.service.js), ANTES incluso de llegar al guard de
// FREE_ENTRY. Este archivo prueba específicamente el guard de FREE_ENTRY,
// no el de prelanzamiento (ese vive en publicLaunchSettings.test.js) — así
// que los dos tests de acá que crean una Sale real (C, H) necesitan
// publicLaunchEnabled=true mientras dura esa llamada puntual, para que el
// guard de prelanzamiento no enmascare lo que realmente se está probando.
// Restaura el valor previo siempre, nunca deja la fila de TEST distinta a
// como la encontró.
async function withPublicLaunchEnabled(run) {
    const before = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
    await setPublicLaunchEnabledService(null, true);
    try {
        return await run();
    } finally {
        if (before) {
            await prisma.publicLaunchSettings.update({ where: { id: before.id }, data: { publicLaunchEnabled: before.publicLaunchEnabled, updatedByUserId: before.updatedByUserId } });
        }
    }
}

// ==================================================================
// A) FREE_ENTRY: guardar la agenda con ticketTypes=[] y publicar sin
// catálogo tiene que funcionar de punta a punta (create -> schedule ->
// publish), sin NO_TICKET_TYPES ni FUNCTION_WITHOUT_TICKET_ASSIGNMENTS.
// ==================================================================

testWithDb("A) FREE_ENTRY: se puede guardar la agenda con ticketTypes=[] y publicar sin catálogo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createEventService(owner.clerkId, { title: "Feria de prueba", admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
        assert.equal(event.admissionType, "FREE_ENTRY");
        assert.equal(event.isFree, true, "FREE_ENTRY debe quedar isFree=true para que las cards públicas muestren Gratis");

        const synced = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            { functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }], ticketTypes: [] },
            org.id
        );
        assert.equal(synced.ticketTypes.length, 0);
        assert.equal(synced.functions.length, 1);

        const published = await updateMyEventService(owner.clerkId, event.id, { status: "PUBLISHED" }, org.id);
        assert.equal(published.status, "PUBLISHED");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// B) TICKETED: ticketTypes=[] sigue rechazado exactamente igual que antes
// de esta ronda — no regression sobre el flujo de siempre.
// ==================================================================

testWithDb("B) TICKETED: ticketTypes=[] sigue rechazado con NO_TICKET_TYPES, sin cambios", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const event = await createEventService(owner.clerkId, { title: "Show pago de prueba", location: locationInput() }, org.id);
    try {
        assert.equal(event.admissionType, "TICKETED", "sin admissionType explícito, el default debe seguir siendo TICKETED");

        await assert.rejects(
            () =>
                syncEventScheduleService(
                    owner.clerkId,
                    event.id,
                    { functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Teatro Real" }], ticketTypes: [] },
                    org.id
                ),
            (error) => {
                assert.equal(error.message, "NO_TICKET_TYPES");
                return true;
            }
        );
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// C) createSaleForBuyer — guard autoritativo: un evento FREE_ENTRY nunca
// puede terminar en una Sale, sin importar qué se le mande.
// ==================================================================

testWithDb("C) createSaleForBuyer rechaza un evento FREE_ENTRY y no crea ninguna Sale", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    const org = await createOrganization(owner.id);
    const event = await prisma.event.create({
        data: {
            title: "Picnic gratuito",
            slug: `picnic-${uniqueSuffix()}`,
            organizationId: org.id,
            createdBy: owner.id,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            admissionType: "FREE_ENTRY",
        },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 86400000), venue: "Parque de prueba", status: "SCHEDULED" },
    });

    try {
        await withPublicLaunchEnabled(() =>
            assert.rejects(
                () => createSaleForBuyer(buyer, { eventId: event.id, functionId: eventFunction.id, items: [], buyerDocument: "30111222" }),
                (error) => {
                    assert.equal(error.code, "EVENT_FREE_ENTRY_NO_SALES");
                    return true;
                }
            )
        );

        const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
        assert.equal(salesCount, 0);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// ==================================================================
// E/F) Creación conversacional — mismo motor para web y WhatsApp
// (EventCreationEngine -> EventServicePort.commit): "gratis sin control de
// acceso" tiene que producir FREE_ENTRY real (sin TicketType fantasma);
// "gratis CON control de acceso" tiene que seguir siendo TICKETED con una
// entrada real a $0 — los dos casos nunca deben mezclarse.
// ==================================================================

testWithDb("E) conversación 'gratis, sin control de acceso' produce FREE_ENTRY con catálogo vacío (sin TicketType fantasma)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const draft = buildDraft({
            pricingType: "FREE",
            hasTickets: false,
            wantsFreeTickets: false,
            ticketTypes: [],
            admissionType: "FREE_ENTRY",
        });
        event = await commit(owner.clerkId, draft, "PUBLISH", org.id);

        assert.equal(event.admissionType, "FREE_ENTRY");
        assert.equal(event.ticketTypes.length, 0, "no debe existir ningún TicketType, ni siquiera uno fantasma");
        assert.equal(event.status, "PUBLISHED");
        assert.equal(event.isFree, true);

        const phantom = await prisma.ticketType.findFirst({ where: { eventId: event.id, name: "Entrada general" } });
        assert.equal(phantom, null, "el workaround retirado ('Entrada general' price 0 quantity 999999) no debe reaparecer");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("F) conversación 'gratis, CON control de acceso' sigue siendo TICKETED con un TicketType real a $0", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const draft = buildDraft({
            pricingType: "FREE",
            hasTickets: true,
            wantsFreeTickets: true,
            ticketTypes: [{ name: "Entrada gratuita", price: 0, quantity: 300 }],
            admissionType: "TICKETED",
        });
        event = await commit(owner.clerkId, draft, "PUBLISH", org.id);

        assert.equal(event.admissionType, "TICKETED");
        assert.equal(event.ticketTypes.length, 1);
        assert.equal(event.ticketTypes[0].name, "Entrada gratuita");
        assert.equal(Number(event.ticketTypes[0].price), 0);
        assert.equal(Number(event.ticketTypes[0].quantity), 300);
        assert.equal(event.isFree, true, "TICKETED con todas las entradas a $0 sigue mostrando Gratis — misma fórmula de siempre, sin cambios");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// G) Compatibilidad hacia atrás — sin especificar admissionType (ni en la
// creación directa ni en la conversacional), el resultado siempre es
// TICKETED, igual que cualquier evento creado antes de esta ronda.
// ==================================================================

testWithDb("G) sin admissionType explícito, la creación directa y la conversacional producen TICKETED", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const direct = await createEventService(owner.clerkId, { title: "Evento sin modalidad explícita", location: locationInput() }, org.id);
    let conversational;
    try {
        assert.equal(direct.admissionType, "TICKETED");

        conversational = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);
        assert.equal(conversational.admissionType, "TICKETED");
    } finally {
        await cleanup({
            eventIds: [direct.id, conversational?.id].filter(Boolean),
            organizationIds: [org.id],
            userIds: [owner.id],
        });
    }
});

// ==================================================================
// H) Cambio de modalidad — regla simple y restrictiva: sólo mientras
// status=DRAFT, nunca si ya existe una Sale/Ticket real, y sólo hacia
// FREE_ENTRY si el catálogo ya está vacío. Cubre los 4 escenarios pedidos:
// DRAFT sin datos (permitido en ambas direcciones), DRAFT con catálogo
// (bloqueado hacia FREE_ENTRY), DRAFT con una Sale real (bloqueado sin
// importar la dirección), y PUBLISHED (bloqueado sin importar nada más).
// ==================================================================

testWithDb("H) cambio de admissionType sólo permitido en DRAFT, sin ventas reales ni catálogo incompatible", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const buyer = await createUser({ role: "CUSTOMER" });

    // H1) DRAFT sin catálogo ni ventas: TICKETED -> FREE_ENTRY -> TICKETED, ambas direcciones libres.
    const eventA = await createEventService(owner.clerkId, { title: "A", location: locationInput() }, org.id);
    const toFree = await updateMyEventService(owner.clerkId, eventA.id, { admissionType: "FREE_ENTRY" }, org.id);
    assert.equal(toFree.admissionType, "FREE_ENTRY");
    assert.equal(toFree.isFree, true);
    const backToTicketed = await updateMyEventService(owner.clerkId, eventA.id, { admissionType: "TICKETED" }, org.id);
    assert.equal(backToTicketed.admissionType, "TICKETED");

    // H2) DRAFT con catálogo ya cargado: TICKETED -> FREE_ENTRY bloqueado (no se borra nada en silencio).
    const eventB = await createEventService(owner.clerkId, { title: "B", location: locationInput() }, org.id);
    await syncEventScheduleService(
        owner.clerkId,
        eventB.id,
        { functions: [{ date: "2099-01-01T20:00:00-03:00", venue: "V" }], ticketTypes: [{ name: "General", price: 1000, quantity: 10 }] },
        org.id
    );
    await assert.rejects(
        () => updateMyEventService(owner.clerkId, eventB.id, { admissionType: "FREE_ENTRY" }, org.id),
        (error) => {
            assert.equal(error.message, "ADMISSION_TYPE_TICKET_TYPES_EXIST");
            return true;
        }
    );

    // H3) DRAFT pero con una Sale real ya asociada: bloqueado sin importar el estado.
    const eventC = await createEventService(owner.clerkId, { title: "C", location: locationInput() }, org.id);
    const syncedC = await syncEventScheduleService(
        owner.clerkId,
        eventC.id,
        { functions: [{ date: "2099-01-01T20:00:00-03:00", venue: "V" }], ticketTypes: [{ name: "General", price: 1000, quantity: 10 }] },
        org.id
    );
    await withPublicLaunchEnabled(() =>
        createSaleForBuyer(buyer, {
            eventId: eventC.id,
            functionId: syncedC.functions[0].id,
            items: [{ ticketTypeId: syncedC.ticketTypes[0].id, quantity: 1 }],
            buyerDocument: "30111222",
        })
    );
    await assert.rejects(
        () => updateMyEventService(owner.clerkId, eventC.id, { admissionType: "FREE_ENTRY" }, org.id),
        (error) => {
            assert.equal(error.message, "ADMISSION_TYPE_HAS_REAL_DATA");
            return true;
        }
    );

    // H4) Evento PUBLICADO: la modalidad queda fija para siempre, en cualquier dirección.
    const eventD = await createEventService(owner.clerkId, { title: "D", admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
    await syncEventScheduleService(owner.clerkId, eventD.id, { functions: [{ date: "2099-01-01T20:00:00-03:00", venue: "V" }], ticketTypes: [] }, org.id);
    await updateMyEventService(owner.clerkId, eventD.id, { status: "PUBLISHED" }, org.id);
    await assert.rejects(
        () => updateMyEventService(owner.clerkId, eventD.id, { admissionType: "TICKETED" }, org.id),
        (error) => {
            assert.equal(error.message, "ADMISSION_TYPE_LOCKED");
            return true;
        }
    );

    await cleanup({
        eventIds: [eventA.id, eventB.id, eventC.id, eventD.id],
        organizationIds: [org.id],
        userIds: [owner.id, buyer.id],
    });
});
