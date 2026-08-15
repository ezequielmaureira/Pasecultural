import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { commit } from "../src/conversation/EventServicePort.js";
import { syncEventLinksService, syncEventScheduleService, updateMyEventService } from "../src/services/event.service.js";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";

// Fase 3O (perf PREVIEW_PUBLISH) — igual que whatsappOrganizerDiscovery.test.js:
// createEventService/syncEventLinksService/syncEventScheduleService tocan
// Prisma real (create/transacciones/constraints no son expresables como
// funciones puras), así que se prueban acá contra una base real, nunca con
// mocks de Prisma. A diferencia de ese archivo, ACÁ se corre a propósito
// contra una base de test SEPARADA (backend/.env.test, ver informe de
// entrega) — nunca contra la base real del proyecto.
//
// Guardrail centralizado — ver tests/helpers/dbGuard.js. Reemplaza el
// `Boolean(process.env.DATABASE_URL)` que tenía este archivo: ese chequeo
// sólo verifica que la variable exista, nunca a qué proyecto apunta (ver
// "Encontrar el test exacto que contaminó producción" — el mismo patrón en
// whatsappOrganizerDiscovery.test.js escribió datos reales en producción).

import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// Mismo patrón que eventCreationEngine.conversationStateCache.test.js (Fase
// 4/2B): reutiliza la instrumentación [WA_PERF] ya existente
// (instrumentPrismaClient, activa sólo con WHATSAPP_PERF_LOG=true) para
// contar operaciones Prisma reales por nombre exacto, sin mockear Prisma.
function withPerfEnv(run) {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    process.env.WHATSAPP_PERF_LOG = "true";
    return run().finally(() => {
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    });
}

function withPerfLogCapture(run) {
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });
    return run(calls).finally(() => {
        logger.info = originalInfo;
    });
}

function countCalls(dbCalls, label) {
    return dbCalls.filter((c) => c.label.toLowerCase() === label.toLowerCase()).length;
}

async function commitWithDbCalls(clerkId, draft, action, organizationId) {
    return withPerfEnv(() =>
        withPerfLogCapture(async (calls) => {
            const timer = startWhatsappPerfTimer();
            enterWithActiveTimer(timer);
            const event = await commit(clerkId, draft, action, organizationId);
            timer.finish({ conversationId: "test" });
            const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
            return { event, dbCalls };
        })
    );
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `owner_${suffix}@example.com`,
            firstName: "Test",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Test Org ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    // event_links/event_functions/ticket_types/function_ticket_types cascadean
    // desde Event (onDelete: Cascade, ver schema.prisma) — borrar el Event
    // alcanza para limpiar todo lo que crea commit()/syncEvent*Service.
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

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
        functions: [
            { date: "2099-08-25", startTime: "20:00", endTime: "23:00" },
            { date: "2099-09-01", startTime: "21:00", endTime: "23:30" },
        ],
        hasTickets: true,
        ticketTypes: [
            { name: "General", price: 20000, quantity: 100 },
            { name: "VIP", price: 45000, quantity: 20 },
        ],
        promoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
        socialLinks: [{ network: "INSTAGRAM", url: "https://instagram.com/test" }],
        ...overrides,
    };
}

// ==================================================================
// A. commit() end-to-end — el camino real de PREVIEW_PUBLISH/PREVIEW_DRAFT
// ==================================================================

testWithDb("commit(PUBLISH): persiste evento, links (createMany), funciones y catálogo, y devuelve el evento publicado completo", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "PUBLISH", org.id);

        assert.equal(event.status, "PUBLISHED");
        assert.equal(event.organizationId, org.id);

        // Links: buildDraft() manda 1 video promocional + 1 red social -> 2 links.
        assert.equal(event.links.length, 2);
        const orders = event.links.map((l) => l.order).sort();
        assert.deepEqual(orders, [0, 1]);
        assert.ok(event.links.some((l) => l.url === "https://youtu.be/dQw4w9WgXcQ"));
        assert.ok(event.links.some((l) => l.url === "https://instagram.com/test"));

        assert.equal(event.functions.length, 2);
        assert.equal(event.ticketTypes.length, 2);
        // Cada función tiene una asignación habilitada por cada ticketType
        // (2 funciones x 2 ticketTypes = 4 filas de function_ticket_types).
        for (const fn of event.functions) {
            assert.equal(fn.ticketAssignments.length, 2);
            assert.ok(fn.ticketAssignments.every((a) => a.enabled));
        }

        // Verificación directa en DB (no sólo lo que devuelve el include):
        // confirma que createMany dejó exactamente las filas esperadas, sin
        // duplicados ni faltantes.
        const linkRows = await prisma.eventLink.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
        assert.equal(linkRows.length, 2);
        assert.equal(linkRows[0].order, 0);
        assert.equal(linkRows[1].order, 1);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("commit(DRAFT): sin links (buildLinksInput vacío) nunca llama a syncEventLinksService, el evento queda DRAFT sin links", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const draft = buildDraft({ promoVideoUrl: null, socialLinks: [] });
        event = await commit(owner.clerkId, draft, "DRAFT", org.id);

        assert.equal(event.status, "DRAFT");
        assert.equal(event.links.length, 0);
        assert.equal(event.functions.length, 2);
        assert.equal(event.ticketTypes.length, 2);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("commit(): organización que no pertenece al clerkId sigue rechazada (ownership no se debilitó)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const otherOwner = await createUser();
    try {
        await assert.rejects(
            () => commit(otherOwner.clerkId, buildDraft(), "PUBLISH", org.id),
            (error) => {
                assert.equal(error.message, "ORGANIZATION_FORBIDDEN");
                return true;
            }
        );

        // No debe haber quedado ningún Event huérfano creado antes del rechazo.
        const orphaned = await prisma.event.findMany({ where: { organizationId: org.id } });
        assert.equal(orphaned.length, 0);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, otherOwner.id] });
    }
});

// ==================================================================
// B. syncEventLinksService — createMany + returnEvent en aislamiento
// ==================================================================

testWithDb("syncEventLinksService: returnEvent:false persiste los links pero no hace el findUnique con include (devuelve null)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft({ promoVideoUrl: null, socialLinks: [] }), "DRAFT", org.id);

        const result = await syncEventLinksService(
            owner.clerkId,
            event.id,
            [
                { url: "https://a.example.com", title: "A" },
                { url: "https://b.example.com", title: "B" },
                { url: "https://c.example.com", title: "C" },
            ],
            org.id,
            { returnEvent: false }
        );

        assert.equal(result, null);

        const linkRows = await prisma.eventLink.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
        assert.equal(linkRows.length, 3);
        assert.deepEqual(linkRows.map((l) => l.order), [0, 1, 2]);
        assert.deepEqual(linkRows.map((l) => l.url), ["https://a.example.com", "https://b.example.com", "https://c.example.com"]);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("syncEventLinksService: default (sin opciones) devuelve el evento completo con EVENT_DETAIL_INCLUDE — comportamiento de Web sin cambios", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft({ promoVideoUrl: null, socialLinks: [] }), "DRAFT", org.id);

        const result = await syncEventLinksService(owner.clerkId, event.id, [{ url: "https://a.example.com", title: "A" }], org.id);

        assert.ok(result, "debe devolver el evento, no null");
        assert.equal(result.id, event.id);
        assert.equal(result.links.length, 1);
        assert.equal(result.links[0].url, "https://a.example.com");
        // EVENT_DETAIL_INCLUDE también trae funciones/ticketTypes.
        assert.equal(result.functions.length, 2);
        assert.equal(result.ticketTypes.length, 2);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("syncEventLinksService: una segunda llamada reemplaza completamente el set anterior (deleteMany + createMany), sin filas residuales", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft({ promoVideoUrl: null, socialLinks: [] }), "DRAFT", org.id);

        await syncEventLinksService(
            owner.clerkId,
            event.id,
            [
                { url: "https://old1.example.com", title: "Old 1" },
                { url: "https://old2.example.com", title: "Old 2" },
            ],
            org.id,
            { returnEvent: false }
        );

        await syncEventLinksService(owner.clerkId, event.id, [{ url: "https://new.example.com", title: "New" }], org.id, { returnEvent: false });

        const linkRows = await prisma.eventLink.findMany({ where: { eventId: event.id } });
        assert.equal(linkRows.length, 1);
        assert.equal(linkRows[0].url, "https://new.example.com");
        assert.equal(linkRows[0].order, 0);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// C. syncEventScheduleService — returnEvent en aislamiento
// ==================================================================

testWithDb("syncEventScheduleService: returnEvent:false persiste funciones/catálogo/asignaciones pero devuelve null", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        const result = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            {
                functions: [{ date: "2099-10-10T20:00:00-03:00", venue: "Otro lugar", endAt: "2099-10-10T23:00:00-03:00" }],
                ticketTypes: [{ name: "Única", price: 1000, quantity: 50 }],
            },
            org.id,
            { returnEvent: false }
        );

        assert.equal(result, null);

        const functions = await prisma.eventFunction.findMany({ where: { eventId: event.id } });
        const ticketTypes = await prisma.ticketType.findMany({ where: { eventId: event.id } });
        assert.equal(functions.length, 1);
        assert.equal(ticketTypes.length, 1);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("syncEventScheduleService: default (sin opciones) sigue devolviendo el evento completo — comportamiento de Web sin cambios", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        const result = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            {
                functions: [{ date: "2099-10-10T20:00:00-03:00", venue: "Otro lugar", endAt: "2099-10-10T23:00:00-03:00" }],
                ticketTypes: [{ name: "Única", price: 1000, quantity: 50 }],
            },
            org.id
        );

        assert.ok(result, "debe devolver el evento, no null");
        assert.equal(result.functions.length, 1);
        assert.equal(result.ticketTypes.length, 1);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// D. FASE 3 (perf PREVIEW_DRAFT) — commit()'s DRAFT branch reads the final
// event via event.service.js#getEventWithDetailsById instead of
// getMyEventByIdService: no redundant getMyOrganization() re-fetch (User +
// Organization ya resueltos por createEventService en la misma llamada) y
// sin el self-heal de archivado (matemáticamente imposible que encuentre
// algo en un evento recién creado, todavía DRAFT). La rama PUBLISH
// (updateMyEventService) y todo lo previo a la bifurcación (createEventService/
// syncEventLinksService/syncEventScheduleService) quedan intocados — se
// verifica acá que su desglose de dbCalls es BYTE A BYTE igual al de antes.
//
// Fase 8.1/8.2 (perf) — actualiza los conteos de referencia de esta misma
// sección: commit() ahora resuelve User+Organization UNA sola vez (en vez
// de repetirlo en cada una de las 4 llamadas que encadena) y nunca ejecuta
// eventFunction.deleteMany/ticketType.deleteMany sobre un evento recién
// creado (ver skipDelete en syncEventScheduleService). Los números de abajo
// (20->14, 15->11, 23->15) están recalculados a mano, operación por
// operación, en el informe de entrega de esta fase — no son una suposición.
// ==================================================================

testWithDb("FASE 8.1/8.2) commit(DRAFT) with links: User+Organization se resuelven UNA sola vez y los deletes de agenda se saltean — 20 -> 14", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const result = await commitWithDbCalls(owner.clerkId, buildDraft(), "DRAFT", org.id);
        event = result.event;
        const { dbCalls } = result;

        assert.equal(dbCalls.length, 14, `dbCallCount esperado 14, dbCalls: ${JSON.stringify(dbCalls.map((c) => c.label))}`);
        assert.equal(countCalls(dbCalls, "User.findUnique"), 1, "un único getMyOrganization para TODO commit(), reutilizado por las 4 llamadas");
        assert.equal(countCalls(dbCalls, "Organization.findUnique"), 1);
        assert.equal(countCalls(dbCalls, "Event.findUnique"), 4, "slug-check + 2 ownership checks compartidos + la lectura final — sin cambios, 8.1/8.2 no tocan estos");
        assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 0, "evento recién creado en esta misma llamada: nunca puede tener funciones previas que borrar");
        assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 0, "ídem para tipos de entrada");
        assert.equal(countCalls(dbCalls, "EventLink.deleteMany"), 1, "el deleteMany de links NO forma parte de 8.2 — sigue ejecutándose sin cambios");
        assert.equal(countCalls(dbCalls, "Event.findMany"), 0, "el self-heal de archivado ya no se ejecuta para un evento recién creado");
        assert.equal(countCalls(dbCalls, "Event.create"), 1);

        assert.equal(event.status, "DRAFT");
        assert.equal(event.organizationId, org.id);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("FASE 8.1/8.2) commit(DRAFT) without links: mismo ahorro sin la rama de links — 15 -> 11", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const draft = buildDraft({ promoVideoUrl: null, socialLinks: [] });
        const result = await commitWithDbCalls(owner.clerkId, draft, "DRAFT", org.id);
        event = result.event;
        const { dbCalls } = result;

        assert.equal(dbCalls.length, 11, `dbCallCount esperado 11, dbCalls: ${JSON.stringify(dbCalls.map((c) => c.label))}`);
        assert.equal(countCalls(dbCalls, "User.findUnique"), 1, "un único getMyOrganization para TODO commit()");
        assert.equal(countCalls(dbCalls, "Organization.findUnique"), 1);
        assert.equal(countCalls(dbCalls, "Event.findUnique"), 3, "slug-check + ownership de syncEventScheduleService + la lectura final");
        assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 0);
        assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 0);
        assert.equal(countCalls(dbCalls, "Event.findMany"), 0);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("FASE 8.1/8.2) commit(PUBLISH): mismo ahorro en la rama de publicación, ninguna validación de publicación se debilitó — 23 -> 15", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const result = await commitWithDbCalls(owner.clerkId, buildDraft(), "PUBLISH", org.id);
        event = result.event;
        const { dbCalls } = result;

        assert.equal(dbCalls.length, 15, `PREVIEW_PUBLISH esperado 15 operaciones (antes 23), dbCalls: ${JSON.stringify(dbCalls.map((c) => c.label))}`);
        assert.equal(countCalls(dbCalls, "User.findUnique"), 1, "un único getMyOrganization para TODO commit(), incluyendo updateMyEventService");
        assert.equal(countCalls(dbCalls, "Organization.findUnique"), 1);
        assert.equal(countCalls(dbCalls, "Event.findUnique"), 4, "sin cambios — 8.1/8.2 no tocan updateMyEventService.findUnique(EVENT_DETAIL_INCLUDE), eso es 8.3, no autorizado todavía");
        assert.equal(countCalls(dbCalls, "Event.update"), 2, "recomputeEventSummary (dentro de la transacción) + la publicación real — sin cambios");
        assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 0);
        assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 0);
        assert.equal(countCalls(dbCalls, "Event.findMany"), 0, "PUBLISH nunca pasó por getMyEventByIdService, no había self-heal que quitar");

        assert.equal(event.status, "PUBLISHED");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("FASE 3.4) commit(DRAFT) regression: el evento devuelto sigue trayendo funciones/ticketTypes/links completos, igual que con getMyEventByIdService antes", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        assert.equal(event.status, "DRAFT");
        assert.equal(event.organizationId, org.id);
        assert.equal(event.links.length, 2);
        assert.equal(event.functions.length, 2);
        assert.equal(event.ticketTypes.length, 2);
        for (const fn of event.functions) {
            assert.equal(fn.ticketAssignments.length, 2);
        }
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// E. Fase 8.2 — skipDelete: default preservado (Web/edición) vs. explícito
// (evento recién creado). Ambos casos probados en aislamiento, sin pasar
// por commit(), llamando syncEventScheduleService directo como lo haría
// cualquier caller real.
// ==================================================================

testWithDb("3) syncEventScheduleService con skipDelete:true NUNCA ejecuta deleteMany, aunque el evento ya tuviera funciones/tipos de entrada", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        // buildDraft() por defecto ya deja el evento con 2 funciones + 2 ticketTypes.
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);

                await syncEventScheduleService(
                    owner.clerkId,
                    event.id,
                    {
                        functions: [{ date: "2099-11-11T20:00:00-03:00", venue: "Lugar nuevo" }],
                        ticketTypes: [{ name: "Nueva", price: 500, quantity: 10 }],
                    },
                    org.id,
                    { returnEvent: false, skipDelete: true }
                );

                timer.finish({});
                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 0, "skipDelete:true nunca debe disparar el deleteMany de funciones");
                assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 0, "ídem tipos de entrada");
            })
        );

        // Como no se borró nada, las 2 funciones originales de buildDraft()
        // conviven con la nueva -> demuestra que skipDelete:true confía de
        // verdad en la garantía del caller (nunca se usa así desde una
        // edición real — sólo EventServicePort.commit() lo pasa, y sólo
        // porque el evento se acaba de crear en la misma llamada).
        const functions = await prisma.eventFunction.findMany({ where: { eventId: event.id } });
        assert.equal(functions.length, 3, "2 originales + 1 nueva, porque nada se borró");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("4) syncEventScheduleService SIN skipDelete (default) sigue borrando y reemplazando por completo la agenda existente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);

                await syncEventScheduleService(
                    owner.clerkId,
                    event.id,
                    {
                        functions: [{ date: "2099-11-11T20:00:00-03:00", venue: "Lugar nuevo" }],
                        ticketTypes: [{ name: "Única", price: 500, quantity: 10 }],
                    },
                    org.id,
                    { returnEvent: false } // default: skipDelete queda false
                );

                timer.finish({});
                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 1, "el default sigue borrando — comportamiento de Web/edición sin cambios");
                assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 1);
            })
        );

        const functions = await prisma.eventFunction.findMany({ where: { eventId: event.id } });
        assert.equal(functions.length, 1, "reemplazo completo, nunca acumulación, cuando skipDelete no se pide explícitamente");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// F. Fase 8.1 — Web sigue llamando estos services SIN `context`: cada
// llamada paga su propia resolución de User+Organization, exactamente como
// antes de esta fase. Ningún caller existente (event.controller.js) cambia
// su forma de invocar estas funciones — el parámetro nuevo es puramente
// aditivo.
// ==================================================================

testWithDb("5) llamadas estilo Web (sin context, sin skipDelete) se comportan exactamente como antes: resuelven su propio User+Organization y siguen reemplazando la agenda", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);

                // Exactamente como llamaría event.controller.js (Web): sin
                // `context`, sin `skipDelete` — el 5º parámetro que agregó
                // esta fase directamente OMITIDO, como cualquier caller que
                // no sepa que existe.
                await syncEventScheduleService(
                    owner.clerkId,
                    event.id,
                    { functions: [{ date: "2099-12-01T20:00:00-03:00", venue: "Y" }], ticketTypes: [{ name: "Única", price: 100, quantity: 5 }] },
                    org.id
                );

                timer.finish({});
                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                assert.equal(countCalls(dbCalls, "User.findUnique"), 1, "Web sigue pagando su propia resolución, sin contexto compartido");
                assert.equal(countCalls(dbCalls, "Organization.findUnique"), 1);
                assert.equal(countCalls(dbCalls, "EventFunction.deleteMany"), 1, "Web sigue reemplazando la agenda completa, comportamiento sin cambios");
                assert.equal(countCalls(dbCalls, "TicketType.deleteMany"), 1);
            })
        );
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// G. PUBLISH sigue validando — assertPublishable no se debilitó por
// resolver el contexto una sola vez.
// ==================================================================

testWithDb("6) PUBLISH sigue rechazando un evento incompleto — assertPublishable (dentro de updateMyEventService) no se debilitó al reutilizar el contexto", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        // Simula un evento que llega a este punto sin nombre de lugar (nunca
        // debería pasar por el flujo normal de WhatsApp/Web, pero
        // assertPublishable es la última línea de defensa real antes de
        // publicar — se prueba directo, manipulando el estado persistido,
        // para aislar específicamente esta validación de las que ya corren
        // antes en syncEventScheduleService).
        await prisma.event.update({ where: { id: event.id }, data: { venueName: null } });

        await assert.rejects(
            () => updateMyEventService(owner.clerkId, event.id, { status: "PUBLISHED" }, org.id),
            (error) => {
                assert.equal(error.message, "LOCATION_MISSING_VENUE_NAME");
                return true;
            }
        );

        const reloaded = await prisma.event.findUnique({ where: { id: event.id } });
        assert.equal(reloaded.status, "DRAFT", "un rechazo de publicación nunca debe dejar el evento marcado como publicado");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// H. Seguridad — un contexto que no coincide con lo que la llamada puntual
// pide NUNCA se reutiliza a ciegas: se descarta y se resuelve de nuevo
// contra la base con el clerkId/organizationId REALES.
// ==================================================================

testWithDb("8a) un contexto de OTRO usuario (clerkId distinto) nunca se confía — se re-resuelve y opera bajo la organización REAL del clerkId pedido", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const attacker = await createUser();
    const attackerOrg = await createOrganization(attacker.id);
    let event;
    try {
        event = await commit(owner.clerkId, buildDraft(), "DRAFT", org.id);

        // Contexto "forjado": pertenece a `attacker`/`attackerOrg`, no a
        // `owner`/`org` — simula un caller que pasa un contexto que no le
        // corresponde a ESTA llamada puntual.
        const forgedContext = { user: attacker, organization: attackerOrg };

        const result = await updateMyEventService(owner.clerkId, event.id, { status: "PUBLISHED" }, org.id, { context: forgedContext });

        assert.ok(result, "debía descartar el contexto forjado, resolver de nuevo y completar la operación bajo el dueño real");
        assert.equal(result.organizationId, org.id, "nunca debe terminar operando bajo la organización del contexto forjado");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id, attackerOrg.id], userIds: [owner.id, attacker.id] });
    }
});

testWithDb("8b) un contexto resuelto para OTRA organización del mismo usuario nunca se reutiliza — se re-resuelve para la organización realmente pedida", async () => {
    const owner = await createUser();
    const orgA = await createOrganization(owner.id);
    const orgB = await createOrganization(owner.id);
    let eventA, eventB;
    try {
        eventA = await commit(owner.clerkId, buildDraft(), "DRAFT", orgA.id);
        eventB = await commit(owner.clerkId, buildDraft(), "DRAFT", orgB.id);

        // Contexto legítimo, pero de la Organización A — la llamada de
        // abajo pide explícitamente la Organización B.
        const contextForA = { user: owner, organization: orgA };

        const result = await updateMyEventService(owner.clerkId, eventB.id, { status: "PUBLISHED" }, orgB.id, { context: contextForA });

        assert.ok(result, "debía descartar el contexto de A y resolver B de verdad");
        assert.equal(result.organizationId, orgB.id, "nunca debe reusar el contexto de una organización distinta a la pedida");
    } finally {
        await cleanup({ eventIds: [eventA?.id, eventB?.id].filter(Boolean), organizationIds: [orgA.id, orgB.id], userIds: [owner.id] });
    }
});
