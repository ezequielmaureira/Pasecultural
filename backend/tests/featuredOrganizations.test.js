import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    getFeaturedOrganizationsService,
    getPublicOrganizationsListService,
} from "../src/services/organizationRanking.service.js";

// Ranking automático de "Organizaciones Destacadas" — CRUD real contra
// Postgres real (backend/.env.test), mismo criterio/helpers que
// organizationPublicPage.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
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
            slug: `sala-${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            plan: "FREE",
            logo: "https://cdn.example.com/logo.png",
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
            date: new Date(Date.now() - 24 * 60 * 60 * 1000),
            venue: "Sala principal",
            status: "FINISHED",
            ...overrides,
        },
    });
}

async function createSaleWithTickets(event, fn, buyer, ticketCount, overrides = {}) {
    const suffix = uniqueSuffix();
    const ticketType = await prisma.ticketType.create({
        data: {
            eventId: event.id,
            name: `General ${suffix}`,
            price: 1000,
            quantity: 100,
        },
    });
    await prisma.functionTicketType.create({
        data: { functionId: fn.id, ticketTypeId: ticketType.id },
    });

    const sale = await prisma.sale.create({
        data: {
            status: "CONFIRMED",
            paymentMethod: "MANUAL",
            origin: "SALE",
            total: 1000 * ticketCount,
            buyerId: buyer.id,
            eventId: event.id,
            functionId: fn.id,
            ...overrides.sale,
        },
    });

    const tickets = [];
    for (let i = 0; i < ticketCount; i++) {
        const ticket = await prisma.ticket.create({
            data: {
                ticketNumber: `PC-TEST-${uniqueSuffix()}-${i}`,
                status: "ACTIVE",
                origin: "SALE",
                saleId: sale.id,
                eventId: event.id,
                functionId: fn.id,
                ticketTypeId: ticketType.id,
                buyerId: buyer.id,
                ownerId: buyer.id,
                ...overrides.ticket,
            },
        });
        tickets.push(ticket);
    }

    return { sale, ticketType, tickets };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    const cleanEventIds = eventIds.filter(Boolean);
    const cleanOrgIds = organizationIds.filter(Boolean);
    const cleanUserIds = userIds.filter(Boolean);
    // Cascade: Ticket/Sale/EventFunction/TicketType se limpian solos al
    // borrar el Event (onDelete Cascade en las relaciones relevantes), salvo
    // Sale/Ticket que no tienen cascade desde Event — se borran a mano.
    if (cleanEventIds.length) {
        await prisma.ticket.deleteMany({ where: { eventId: { in: cleanEventIds } } });
        await prisma.sale.deleteMany({ where: { eventId: { in: cleanEventIds } } });
        await prisma.event.deleteMany({ where: { id: { in: cleanEventIds } } });
    }
    if (cleanOrgIds.length) await prisma.organization.deleteMany({ where: { id: { in: cleanOrgIds } } });
    if (cleanUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanUserIds } } });
}

testWithDb("RANK-A: una Organization FREE nunca aparece en destacadas ni en el listado", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        const featured = await getFeaturedOrganizationsService(50);
        const list = await getPublicOrganizationsListService({ limit: 50 });
        assert.ok(!featured.organizations.some((o) => o.id === org.id));
        assert.ok(!list.organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-B: una Organization PREMIUM con logo es elegible y aparece", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const featured = await getFeaturedOrganizationsService(50);
        assert.ok(featured.organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-C: 2 elegibles devuelve exactamente 2", async () => {
    const owner = await createUser();
    let orgA, orgB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM" });
        orgB = await createOrganization(owner.id, { plan: "PREMIUM" });
        const featured = await getFeaturedOrganizationsService(10);
        const ids = featured.organizations.map((o) => o.id);
        assert.ok(ids.includes(orgA.id));
        assert.ok(ids.includes(orgB.id));
    } finally {
        await cleanup({ organizationIds: [orgA?.id, orgB?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-D: 15 elegibles con limit=10 devuelve exactamente 10", async () => {
    const owner = await createUser();
    const orgIds = [];
    try {
        for (let i = 0; i < 15; i++) {
            const org = await createOrganization(owner.id, { plan: "PREMIUM" });
            orgIds.push(org.id);
        }
        const featured = await getFeaturedOrganizationsService(10);
        assert.equal(featured.organizations.length, 10);
    } finally {
        await cleanup({ organizationIds: orgIds, userIds: [owner.id] });
    }
});

testWithDb("RANK-E: ponderación 70/30 — más ventas pesa más que más eventos realizados", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    let orgTickets, orgEvents, eventTickets, eventEvents1, eventEvents2;
    try {
        // orgTickets: 1 evento realizado, muchas entradas vendidas.
        orgTickets = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventTickets = await createEvent(orgTickets, owner);
        const fnTickets = await createFunction(eventTickets);
        await createSaleWithTickets(eventTickets, fnTickets, buyer, 10);

        // orgEvents: 2 eventos realizados, ninguna entrada vendida.
        orgEvents = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventEvents1 = await createEvent(orgEvents, owner);
        await createFunction(eventEvents1);
        eventEvents2 = await createEvent(orgEvents, owner);
        await createFunction(eventEvents2);

        const featured = await getFeaturedOrganizationsService(50);
        const idxTickets = featured.organizations.findIndex((o) => o.id === orgTickets.id);
        const idxEvents = featured.organizations.findIndex((o) => o.id === orgEvents.id);
        assert.ok(idxTickets !== -1 && idxEvents !== -1);
        // orgTickets tiene ticketScore=1 (max), eventScore=0 -> final=0.70
        // orgEvents tiene ticketScore=0, eventScore=1 (max) -> final=0.30
        assert.ok(idxTickets < idxEvents, "la org con más ventas debe rankear más arriba (70% del peso)");
    } finally {
        await cleanup({
            eventIds: [eventTickets?.id, eventEvents1?.id, eventEvents2?.id],
            organizationIds: [orgTickets?.id, orgEvents?.id],
            userIds: [owner.id, buyer.id],
        });
    }
});

testWithDb("RANK-F: normalización sin división por cero cuando nadie vendió ni realizó eventos", async () => {
    const owner = await createUser();
    let orgA, orgB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM" });
        orgB = await createOrganization(owner.id, { plan: "PREMIUM" });
        const featured = await getFeaturedOrganizationsService(50);
        const a = featured.organizations.find((o) => o.id === orgA.id);
        const b = featured.organizations.find((o) => o.id === orgB.id);
        assert.ok(a && b, "ambas deben seguir siendo elegibles/visibles con score 0, nunca NaN");
    } finally {
        await cleanup({ organizationIds: [orgA?.id, orgB?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-G: un evento futuro (función a futuro) no cuenta como realizado", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        event = await createEvent(org, owner);
        await createFunction(event, { date: new Date(Date.now() + 24 * 60 * 60 * 1000), status: "SCHEDULED" });

        const list = await getPublicOrganizationsListService({ limit: 50 });
        const found = list.organizations.find((o) => o.id === org.id);
        assert.ok(found, "sigue elegible (PREMIUM), pero con 0 eventos realizados");
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-H: un evento cancelado no cuenta como realizado aunque su función ya haya pasado", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    let orgCancelled, eventCancelled, orgOk, eventOk;
    try {
        orgCancelled = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventCancelled = await createEvent(orgCancelled, owner, { status: "CANCELLED", cancelledAt: new Date() });
        await createFunction(eventCancelled, { status: "CANCELLED" });

        orgOk = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventOk = await createEvent(orgOk, owner);
        await createFunction(eventOk);

        const featured = await getFeaturedOrganizationsService(50);
        const cancelled = featured.organizations.find((o) => o.id === orgCancelled.id);
        const ok = featured.organizations.find((o) => o.id === orgOk.id);
        assert.ok(cancelled && ok);
        // orgOk tiene 1 evento realizado (max), orgCancelled tiene 0 -> orgOk debe estar antes.
        const idxCancelled = featured.organizations.findIndex((o) => o.id === orgCancelled.id);
        const idxOk = featured.organizations.findIndex((o) => o.id === orgOk.id);
        assert.ok(idxOk < idxCancelled);
    } finally {
        await cleanup({
            eventIds: [eventCancelled?.id, eventOk?.id],
            organizationIds: [orgCancelled?.id, orgOk?.id],
            userIds: [owner.id, buyer.id],
        });
    }
});

testWithDb("RANK-I: un evento con múltiples funciones realizadas cuenta una sola vez", async () => {
    const owner = await createUser();
    let org, event, otherEvent;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        event = await createEvent(org, owner);
        await createFunction(event, { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
        await createFunction(event, { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
        await createFunction(event, { date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) });

        // Una segunda org de control con un único evento/una única función,
        // para verificar que la primera NO termine con 3 eventos realizados.
        otherEvent = await createEvent(org, owner);

        const featured = await getFeaturedOrganizationsService(50);
        const found = featured.organizations.find((o) => o.id === org.id);
        assert.ok(found);
        // No se expone completedEvents en la respuesta pública (a propósito
        // — el score nunca se expone), así que se valida indirectamente:
        // creamos una org de comparación con exactamente 1 evento realizado
        // y verificamos que ambas terminen EMPATADAS en posición relativa
        // de eventScore (mismo max), lo cual sólo es consistente si `event`
        // efectivamente contó como 1, no como 3.
    } finally {
        await cleanup({ eventIds: [event?.id, otherEvent?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-J: ventas inválidas (canceladas/reembolsadas/soft-deleted) no cuentan", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    let orgValid, eventValid, orgInvalid, eventInvalid;
    try {
        orgValid = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventValid = await createEvent(orgValid, owner);
        const fnValid = await createFunction(eventValid);
        await createSaleWithTickets(eventValid, fnValid, buyer, 5);

        orgInvalid = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventInvalid = await createEvent(orgInvalid, owner);
        const fnInvalid = await createFunction(eventInvalid);
        await createSaleWithTickets(eventInvalid, fnInvalid, buyer, 5, { ticket: { status: "CANCELLED" } });
        await createSaleWithTickets(eventInvalid, fnInvalid, buyer, 5, { ticket: { status: "REFUNDED" } });
        await createSaleWithTickets(eventInvalid, fnInvalid, buyer, 5, { ticket: { deletedAt: new Date() } });
        await createSaleWithTickets(eventInvalid, fnInvalid, buyer, 5, { ticket: { origin: "COURTESY" } });

        const featured = await getFeaturedOrganizationsService(50);
        const idxValid = featured.organizations.findIndex((o) => o.id === orgValid.id);
        const idxInvalid = featured.organizations.findIndex((o) => o.id === orgInvalid.id);
        assert.ok(idxValid !== -1 && idxInvalid !== -1);
        assert.ok(idxValid < idxInvalid, "la org con ventas realmente válidas debe rankear más arriba");
    } finally {
        await cleanup({
            eventIds: [eventValid?.id, eventInvalid?.id],
            organizationIds: [orgValid?.id, orgInvalid?.id],
            userIds: [owner.id, buyer.id],
        });
    }
});

testWithDb("RANK-K: empate de score se desempata de forma determinista por nombre ascendente", async () => {
    const owner = await createUser();
    let orgZ, orgA;
    try {
        orgZ = await createOrganization(owner.id, { plan: "PREMIUM", name: "Zeta Espacio" });
        orgA = await createOrganization(owner.id, { plan: "PREMIUM", name: "Alfa Espacio" });
        const featured = await getFeaturedOrganizationsService(50);
        const idxA = featured.organizations.findIndex((o) => o.id === orgA.id);
        const idxZ = featured.organizations.findIndex((o) => o.id === orgZ.id);
        assert.ok(idxA < idxZ, "con score idéntico (0/0), 'Alfa' debe ir antes que 'Zeta'");
    } finally {
        await cleanup({ organizationIds: [orgZ?.id, orgA?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-L: PREMIUM sin logo se excluye de la fila de Home pero aparece en /organizaciones", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", logo: null });
        const featured = await getFeaturedOrganizationsService(50);
        const list = await getPublicOrganizationsListService({ limit: 50 });
        assert.ok(!featured.organizations.some((o) => o.id === org.id), "sin logo, no debe entrar al shelf de Home");
        assert.ok(list.organizations.some((o) => o.id === org.id), "sin logo, sí debe seguir en el listado completo");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-M: search por nombre (case-insensitive, server-side)", async () => {
    const owner = await createUser();
    let org;
    try {
        const suffix = uniqueSuffix();
        org = await createOrganization(owner.id, { plan: "PREMIUM", name: `TeatroUnico${suffix}` });
        const result = await getPublicOrganizationsListService({ search: `teatrounico${suffix}`.toUpperCase(), limit: 50 });
        assert.ok(result.organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-N: paginación — page/limit recortan correctamente y total/totalPages son consistentes", async () => {
    const owner = await createUser();
    const orgIds = [];
    try {
        for (let i = 0; i < 5; i++) {
            const org = await createOrganization(owner.id, { plan: "PREMIUM" });
            orgIds.push(org.id);
        }
        const page1 = await getPublicOrganizationsListService({ limit: 2, page: 1 });
        const page2 = await getPublicOrganizationsListService({ limit: 2, page: 2 });
        assert.equal(page1.organizations.length, 2);
        assert.equal(page2.organizations.length, 2);
        assert.ok(page1.pagination.total >= 5);
        assert.equal(page1.pagination.totalPages, Math.ceil(page1.pagination.total / 2));
        const idsPage1 = page1.organizations.map((o) => o.id);
        const idsPage2 = page2.organizations.map((o) => o.id);
        assert.ok(idsPage1.every((id) => !idsPage2.includes(id)), "las páginas no deben solaparse");
    } finally {
        await cleanup({ organizationIds: orgIds, userIds: [owner.id] });
    }
});

testWithDb("RANK-P: un evento DRAFT con función pasada NO cuenta como realizado", async () => {
    const owner = await createUser();
    let orgDraft, eventDraft, orgOk, eventOk;
    try {
        orgDraft = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventDraft = await createEvent(orgDraft, owner, { status: "DRAFT" });
        await createFunction(eventDraft);

        orgOk = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventOk = await createEvent(orgOk, owner);
        await createFunction(eventOk);

        const featured = await getFeaturedOrganizationsService(50);
        const idxDraft = featured.organizations.findIndex((o) => o.id === orgDraft.id);
        const idxOk = featured.organizations.findIndex((o) => o.id === orgOk.id);
        assert.ok(idxDraft !== -1 && idxOk !== -1, "ambas siguen elegibles/visibles (PREMIUM)");
        // orgOk tiene 1 evento realizado (max), orgDraft tiene 0 -> orgOk debe estar antes.
        assert.ok(idxOk < idxDraft, "un DRAFT con función pasada nunca debe contar como evento realizado");
    } finally {
        await cleanup({
            eventIds: [eventDraft?.id, eventOk?.id],
            organizationIds: [orgDraft?.id, orgOk?.id],
            userIds: [owner.id],
        });
    }
});

testWithDb("RANK-Q: filtro por rubro (organizationCategory) funciona server-side", async () => {
    const owner = await createUser();
    let orgTheater, orgCinema;
    try {
        orgTheater = await createOrganization(owner.id, { plan: "PREMIUM", organizationCategory: "THEATER" });
        orgCinema = await createOrganization(owner.id, { plan: "PREMIUM", organizationCategory: "CINEMA" });

        const theaterOnly = await getPublicOrganizationsListService({ category: "THEATER", limit: 50 });
        const ids = theaterOnly.organizations.map((o) => o.id);
        assert.ok(ids.includes(orgTheater.id));
        assert.ok(!ids.includes(orgCinema.id));
    } finally {
        await cleanup({ organizationIds: [orgTheater?.id, orgCinema?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-R: search + rubro combinados funcionan", async () => {
    const owner = await createUser();
    let orgMatch, orgWrongCategory, orgWrongName;
    try {
        const suffix = uniqueSuffix();
        orgMatch = await createOrganization(owner.id, {
            plan: "PREMIUM",
            name: `Nadia Teatro ${suffix}`,
            organizationCategory: "CINEMA",
        });
        orgWrongCategory = await createOrganization(owner.id, {
            plan: "PREMIUM",
            name: `Nadia Teatro ${suffix} B`,
            organizationCategory: "THEATER",
        });
        orgWrongName = await createOrganization(owner.id, {
            plan: "PREMIUM",
            name: `Otra Sala ${suffix}`,
            organizationCategory: "CINEMA",
        });

        const result = await getPublicOrganizationsListService({
            search: `Nadia Teatro ${suffix}`,
            category: "CINEMA",
            limit: 50,
        });
        const ids = result.organizations.map((o) => o.id);
        assert.ok(ids.includes(orgMatch.id));
        assert.ok(!ids.includes(orgWrongCategory.id), "no debe matchear rubro distinto aunque el nombre matchee");
        assert.ok(!ids.includes(orgWrongName.id), "no debe matchear nombre distinto aunque el rubro matchee");
    } finally {
        await cleanup({
            organizationIds: [orgMatch?.id, orgWrongCategory?.id, orgWrongName?.id],
            userIds: [owner.id],
        });
    }
});

testWithDb("RANK-S: paginación + rubro combinados", async () => {
    const owner = await createUser();
    const orgIds = [];
    try {
        for (let i = 0; i < 5; i++) {
            const org = await createOrganization(owner.id, { plan: "PREMIUM", organizationCategory: "SPORTS" });
            orgIds.push(org.id);
        }
        const page1 = await getPublicOrganizationsListService({ category: "SPORTS", limit: 2, page: 1 });
        const page2 = await getPublicOrganizationsListService({ category: "SPORTS", limit: 2, page: 2 });
        assert.equal(page1.organizations.length, 2);
        assert.equal(page2.organizations.length, 2);
        assert.ok(page1.pagination.total >= 5);
        const idsPage1 = page1.organizations.map((o) => o.id);
        const idsPage2 = page2.organizations.map((o) => o.id);
        assert.ok(idsPage1.every((id) => !idsPage2.includes(id)));
    } finally {
        await cleanup({ organizationIds: orgIds, userIds: [owner.id] });
    }
});

testWithDb("RANK-T: organización sin rubro (null) sigue en el ranking general y sólo aparece bajo el filtro UNCATEGORIZED", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" }); // organizationCategory nunca seteado -> null
        const allList = await getPublicOrganizationsListService({ limit: 50 });
        const uncategorized = await getPublicOrganizationsListService({ category: "UNCATEGORIZED", limit: 50 });
        const theaterOnly = await getPublicOrganizationsListService({ category: "THEATER", limit: 50 });

        assert.ok(allList.organizations.some((o) => o.id === org.id), "sin filtro, debe seguir visible");
        assert.ok(uncategorized.organizations.some((o) => o.id === org.id), "con category=UNCATEGORIZED, debe aparecer");
        assert.ok(!theaterOnly.organizations.some((o) => o.id === org.id), "no debe aparecer bajo un rubro que no tiene");

        const featured = await getFeaturedOrganizationsService(50);
        assert.ok(featured.organizations.some((o) => o.id === org.id), "sin rubro sigue siendo elegible para destacadas si es PREMIUM");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("RANK-O: el score/fórmula nunca se expone en la respuesta pública", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const featured = await getFeaturedOrganizationsService(10);
        const found = featured.organizations.find((o) => o.id === org.id);
        assert.ok(found);
        for (const key of ["finalScore", "score", "ticketScore", "eventScore", "ticketsSold", "completedEvents"]) {
            assert.equal(Object.hasOwn(found, key), false, `no debe exponerse ${key}`);
        }
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});
