import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { setPublicLaunchEnabledService, isPublicLaunchEnabledOrDefault } from "../src/services/publicLaunchSettings.service.js";
import { getDeveloperLaunchStatus, updateDeveloperLaunchStatus, getPublicLaunchStatus } from "../src/controllers/publicLaunchSettings.controller.js";
import { requirePublicLaunch } from "../src/middlewares/requirePublicLaunch.js";
import { requireRole } from "../src/middlewares/requireRole.js";
import { getPublicEvents, getPublicEventBySlug, getMyEventById } from "../src/controllers/event.controller.js";
import { createSaleForBuyer } from "../src/services/sale.service.js";

// Modo Prelanzamiento — CRUD + guards reales contra Postgres real
// (backend/.env.test), mismo criterio que developerAlertConfig.crud.test.js
// (mismos helpers fakeRes/fakeReqWithAuth). Guardrail centralizado — ver
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
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
    };
    return { res, state };
}

function fakeReqWithAuth(clerkId, extra = {}) {
    const req = { headers: {}, body: {}, query: {}, params: {}, ...extra };
    req.auth = Object.assign(() => ({ userId: clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

// Restaura el estado real de la fila singleton después de cada test que la
// modifica — mismo criterio que developerAlertConfig.crud.test.js con
// originalRow: esta suite no debe dejar la base de TEST en un estado
// distinto al que tenía antes de correr.
async function withRestoredPublicLaunchState(run) {
    const before = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
    try {
        await run();
    } finally {
        if (before) {
            await prisma.publicLaunchSettings.update({ where: { id: before.id }, data: { publicLaunchEnabled: before.publicLaunchEnabled, updatedByUserId: before.updatedByUserId } });
        }
    }
}

async function createPublicEvent(organizationId, createdBy) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: {
            title: `Show ${suffix}`,
            slug: `show-${suffix}`,
            organizationId,
            createdBy,
            status: "PUBLISHED",
            visibility: "PUBLIC",
        },
    });
    await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    return event;
}

// ==================================================================
// A/B) publicLaunchEnabled=false — el guard bloquea el listado Y el
// detalle público de eventos, ambos a través del mismo router.use("/public")
// (event.routes.js) — un único middleware, dos rutas.
// ==================================================================

testWithDb("A) publicLaunchEnabled=false: el guard bloquea el listado público de eventos (nunca llega al controller)", async () => {
    await withRestoredPublicLaunchState(async () => {
        await setPublicLaunchEnabledService(null, false);

        const req = fakeReqWithAuth(null);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requirePublicLaunch(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 503);
        assert.equal(state.jsonBody.message, "PaseCultural todavía no está disponible públicamente.");
    });
});

testWithDb("B) publicLaunchEnabled=false: el guard bloquea el detalle público de un evento (nunca llega al controller)", async () => {
    await withRestoredPublicLaunchState(async () => {
        await setPublicLaunchEnabledService(null, false);

        const req = fakeReqWithAuth(null, { params: { slug: "cualquier-slug" } });
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requirePublicLaunch(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 503);
    });
});

// ==================================================================
// C) publicLaunchEnabled=true — ambos endpoints funcionan normalmente:
// el guard deja pasar (next llamado) y el controller real responde 200
// con los datos esperados.
// ==================================================================

testWithDb("C) publicLaunchEnabled=true: listado y detalle públicos funcionan normalmente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const event = await createPublicEvent(org.id, owner.id);
    try {
        await withRestoredPublicLaunchState(async () => {
            await setPublicLaunchEnabledService(null, true);

            const listReq = fakeReqWithAuth(null);
            const { res: listRes, state: listState } = fakeRes();
            let listNextCalled = false;
            await requirePublicLaunch(listReq, listRes, () => {
                listNextCalled = true;
            });
            assert.equal(listNextCalled, true);
            await getPublicEvents(listReq, listRes);
            assert.equal(listState.statusCode, 200);
            assert.ok(Array.isArray(listState.jsonBody.events));

            const detailReq = fakeReqWithAuth(null, { params: { slug: event.slug } });
            const { res: detailRes, state: detailState } = fakeRes();
            let detailNextCalled = false;
            await requirePublicLaunch(detailReq, detailRes, () => {
                detailNextCalled = true;
            });
            assert.equal(detailNextCalled, true);
            await getPublicEventBySlug(detailReq, detailRes);
            assert.equal(detailState.statusCode, 200);
            assert.equal(detailState.jsonBody.event.id, event.id);
        });
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// D) GET /api/public/launch-status — siempre accesible, en ambos estados.
// ==================================================================

testWithDb("D) GET /api/public/launch-status responde siempre, con publicLaunchEnabled=false y =true", async () => {
    await withRestoredPublicLaunchState(async () => {
        await setPublicLaunchEnabledService(null, false);
        const { res: resFalse, state: stateFalse } = fakeRes();
        await getPublicLaunchStatus(fakeReqWithAuth(null), resFalse);
        assert.equal(stateFalse.statusCode, 200);
        assert.equal(stateFalse.jsonBody.publicLaunchEnabled, false);

        await setPublicLaunchEnabledService(null, true);
        const { res: resTrue, state: stateTrue } = fakeRes();
        await getPublicLaunchStatus(fakeReqWithAuth(null), resTrue);
        assert.equal(stateTrue.statusCode, 200);
        assert.equal(stateTrue.jsonBody.publicLaunchEnabled, true);
    });
});

// ==================================================================
// E) Organizer autenticado — su propia superficie interna (GET
// /api/events/:id, requireAuth, jamás pasa por requirePublicLaunch) sigue
// funcionando igual con publicLaunchEnabled=false.
// ==================================================================

testWithDb("E) Organizer autenticado sigue pudiendo leer su propio evento (GET /api/events/:id) con publicLaunchEnabled=false", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const event = await createPublicEvent(org.id, owner.id);
    try {
        await withRestoredPublicLaunchState(async () => {
            await setPublicLaunchEnabledService(null, false);

            const req = fakeReqWithAuth(owner.clerkId, { params: { id: event.id } });
            const { res, state } = fakeRes();
            await getMyEventById(req, res);

            assert.equal(state.statusCode, 200);
            assert.equal(state.jsonBody.event.id, event.id);
        });
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// F/G) Sólo DEVELOPER puede cambiar el estado — ORGANIZER queda bloqueado
// por requireRole, mismo mecanismo ya probado en
// developerAlertConfig.crud.test.js.
// ==================================================================

testWithDb("F) un DEVELOPER puede cambiar el estado false -> true y true -> false", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        await withRestoredPublicLaunchState(async () => {
            const reqTrue = fakeReqWithAuth(developer.clerkId);
            await requireRole("DEVELOPER")(reqTrue, fakeRes().res, () => {});
            reqTrue.body = { publicLaunchEnabled: true };
            const { res: resTrue, state: stateTrue } = fakeRes();
            await updateDeveloperLaunchStatus(reqTrue, resTrue, () => {});
            assert.equal(stateTrue.statusCode, 200);
            assert.equal(stateTrue.jsonBody.publicLaunchEnabled, true);

            const reqFalse = fakeReqWithAuth(developer.clerkId);
            await requireRole("DEVELOPER")(reqFalse, fakeRes().res, () => {});
            reqFalse.body = { publicLaunchEnabled: false };
            const { res: resFalse, state: stateFalse } = fakeRes();
            await updateDeveloperLaunchStatus(reqFalse, resFalse, () => {});
            assert.equal(stateFalse.statusCode, 200);
            assert.equal(stateFalse.jsonBody.publicLaunchEnabled, false);

            const getReq = fakeReqWithAuth(developer.clerkId);
            const getRes = fakeRes();
            await getDeveloperLaunchStatus(getReq, getRes.res, () => {});
            assert.equal(getRes.state.jsonBody.publicLaunchEnabled, false);
        });
    } finally {
        await cleanup({ userIds: [developer.id] });
    }
});

testWithDb("G) un ORGANIZER no puede modificar (ni leer por el panel) launch-status — requireRole lo bloquea con 403", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = fakeReqWithAuth(organizer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [organizer.id] });
    }
});

// ==================================================================
// H/I) Guard de Sales — origin=SALE bloqueado con publicLaunchEnabled=false,
// origin=COURTESY nunca afectado (cortesías internas siguen funcionando).
// ==================================================================

testWithDb("H) origin=SALE + publicLaunchEnabled=false: createSaleForBuyer rechaza y no crea ninguna Sale", async () => {
    const owner = await createUser();
    const buyer = await createUser({ role: "CUSTOMER" });
    const org = await createOrganization(owner.id);
    const event = await createPublicEvent(org.id, owner.id);
    const eventFunction = await prisma.eventFunction.findFirstOrThrow({ where: { eventId: event.id } });
    try {
        await withRestoredPublicLaunchState(async () => {
            await setPublicLaunchEnabledService(null, false);

            await assert.rejects(
                () => createSaleForBuyer(buyer, { eventId: event.id, functionId: eventFunction.id, items: [], buyerDocument: "30111222" }),
                (error) => {
                    assert.equal(error.code, "PUBLIC_LAUNCH_DISABLED");
                    return true;
                }
            );

            const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
            assert.equal(salesCount, 0);
        });
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("I) origin=COURTESY + publicLaunchEnabled=false: nunca se rompe — el guard es exclusivo de origin=SALE", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const event = await createPublicEvent(org.id, owner.id);
    const eventFunction = await prisma.eventFunction.findFirstOrThrow({ where: { eventId: event.id } });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "Cortesía", price: 0, quantity: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    try {
        await withRestoredPublicLaunchState(async () => {
            await setPublicLaunchEnabledService(null, false);

            const sale = await createSaleForBuyer(
                { id: owner.id },
                { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }] },
                { requireBuyerDocument: false, enforceMaxPerPurchase: false, origin: "COURTESY" }
            );

            assert.equal(sale.origin, "COURTESY");
            const salesCount = await prisma.sale.count({ where: { eventId: event.id, origin: "COURTESY" } });
            assert.equal(salesCount, 1);
        });
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Fail-closed — si la fila no se puede determinar, isPublicLaunchEnabledOrDefault
// nunca revienta y nunca "abre" el sitio por accidente.
// ==================================================================

testWithDb("isPublicLaunchEnabledOrDefault nunca lanza, y con la fila real seteada en false devuelve false", async () => {
    await withRestoredPublicLaunchState(async () => {
        await setPublicLaunchEnabledService(null, false);
        const result = await isPublicLaunchEnabledOrDefault();
        assert.equal(result, false);
    });
});
