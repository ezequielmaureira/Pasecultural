import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { commit } from "../src/conversation/EventServicePort.js";
import { syncEventLinksService, syncEventScheduleService } from "../src/services/event.service.js";

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
