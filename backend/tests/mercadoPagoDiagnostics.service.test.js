import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getMercadoPagoSaleDiagnosticsService } from "../src/services/developerSales.service.js";
import { getMercadoPagoSaleDiagnostics } from "../src/controllers/developerSales.controller.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { requireRole } from "../src/middlewares/requireRole.js";
import { encryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";
import { logger } from "../src/logging/logger.js";

// Herramienta de diagnóstico de Mercado Pago (Developer, SOLO LECTURA) —
// permite investigar un intento de Checkout Pro real que falló antes de
// generar webhook, sin crear una compra nueva. CRUD + Prisma real, mismo
// criterio que el resto de los tests de Mercado Pago: se prueba contra
// Postgres real (backend/.env.test), nunca con mocks de Prisma. Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 11).toString("base64");
process.env.FRONTEND_URL = "https://pasecultural.test";
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 12).toString("base64");

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

async function createMpConnection(organizationId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.mercadoPagoConnection.create({
        data: {
            organizationId,
            mercadoPagoUserId: `mpuser_${suffix}`,
            accessTokenEncrypted: encryptMercadoPagoSecret(`ACCESS-${suffix}`),
            refreshTokenEncrypted: encryptMercadoPagoSecret(`REFRESH-${suffix}`),
            accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            liveMode: false,
            ...overrides,
        },
    });
}

async function createEventWithTicketType(organizationId, createdBy) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 10000, quantity: 100, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
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
    await prisma.mercadoPagoOAuthState.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.mercadoPagoConnection.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function mockMpFetch(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = original;
    };
}
function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Crea una Sale MERCADO_PAGO real (PENDING, con mercadoPagoPreferenceId/
// mercadoPagoExternalReference ya seteados) — usa el service real de
// checkout, exactamente como haría un intento real de compra, en vez de
// insertar filas a mano.
async function createRealFailedCheckout({ event, eventFunction, ticketType }) {
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            return jsonResponse(201, { id: `PREF-${uniqueSuffix()}`, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" });
        }
        throw new Error(`unexpected fetch during setup: ${url}`);
    });
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Nadia", lastName: "Compradora", email: `buyer_${uniqueSuffix()}@example.com` },
            { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
            randomUUID()
        );
        return prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
    } finally {
        restore();
    }
}

function rawPaymentWithSensitiveExtras(overrides = {}) {
    return {
        id: 777888999,
        status: "rejected",
        status_detail: "cc_rejected_insufficient_amount",
        transaction_amount: 10000,
        currency_id: "ARS",
        payment_method_id: "visa",
        payment_type_id: "credit_card",
        collector_id: 1,
        external_reference: "will-be-overridden",
        live_mode: false,
        date_created: "2026-08-19T10:00:00.000Z",
        date_approved: null,
        payer: { email: "comprador@example.com" },
        card: { last_four_digits: "1111" },
        authorization_code: "AUTH123456",
        ...overrides,
    };
}

const SALE_DIAGNOSTIC_WHITELIST = ["id", "status", "total", "mercadoPagoPreferenceId", "mercadoPagoExternalReference", "mercadoPagoPaymentId"];

// ==================================================================
// 1) Resolución de credencial: SIEMPRE la conexión ACTIVE de la
// Organization dueña de la Sale, nunca la de otra Organization.
// ==================================================================

testWithDb("resolves and sends the access_token of the Sale's OWN organization, never another organization's", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    await createMpConnection(orgA.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-A-ONLY") });
    const fixtureA = await createEventWithTicketType(orgA.id, ownerA.id);
    const saleA = await createRealFailedCheckout(fixtureA);

    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    await createMpConnection(orgB.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-B-NEVER-USED") });

    const capturedAuthHeaders = [];
    const restore = mockMpFetch(async (url, options) => {
        capturedAuthHeaders.push(options.headers.Authorization);
        if (String(url).includes("/merchant_orders/search")) return jsonResponse(200, { elements: [] });
        if (String(url).includes("/v1/payments/search")) return jsonResponse(200, { results: [] });
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        await getMercadoPagoSaleDiagnosticsService(saleA.id);
    } finally {
        restore();
    }

    assert.ok(capturedAuthHeaders.length > 0, "debe haber consultado a Mercado Pago");
    for (const header of capturedAuthHeaders) {
        assert.equal(header, "Bearer ACCESS-A-ONLY");
        assert.notEqual(header, "Bearer ACCESS-B-NEVER-USED");
    }

    await cleanup({ eventIds: [fixtureA.event.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
});

// ==================================================================
// 2) Sanitización: payer/card/authorization_code/tokens nunca aparecen,
// aunque Mercado Pago los devuelva.
// ==================================================================

testWithDb("sanitizes the response: payer, card, authorization_code and any token never appear, even if Mercado Pago's raw response includes them", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-SANITIZE") });
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const sale = await createRealFailedCheckout(fixture);

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/merchant_orders/search")) {
            return jsonResponse(200, {
                elements: [
                    {
                        id: 1,
                        status: "closed",
                        preference_id: sale.mercadoPagoPreferenceId,
                        external_reference: sale.mercadoPagoExternalReference,
                        paid_amount: 0,
                        total_amount: 10000,
                        cancelled: false,
                        payer: { email: "comprador@example.com" },
                        payments: [rawPaymentWithSensitiveExtras({ external_reference: sale.mercadoPagoExternalReference, collector_id: connection.mercadoPagoUserId })],
                    },
                ],
            });
        }
        if (String(url).includes("/v1/payments/search")) {
            return jsonResponse(200, { results: [rawPaymentWithSensitiveExtras({ external_reference: sale.mercadoPagoExternalReference, collector_id: connection.mercadoPagoUserId })] });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    let result;
    try {
        result = await getMercadoPagoSaleDiagnosticsService(sale.id);
    } finally {
        restore();
    }

    assert.equal(result.merchantOrders.length, 1);
    assert.equal(result.payments.length, 1);

    // La Sale devuelta expone EXACTAMENTE los campos pedidos, ninguno más.
    assert.deepEqual(Object.keys(result.sale).sort(), [...SALE_DIAGNOSTIC_WHITELIST].sort());

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("comprador@example.com"), "nunca debe filtrar el email del comprador");
    assert.ok(!serialized.includes("1111"), "nunca debe filtrar dígitos de tarjeta");
    assert.ok(!serialized.includes("AUTH123456"), "nunca debe filtrar authorization_code");
    assert.ok(!serialized.includes("ACCESS-SANITIZE"), "el access_token usado para consultar nunca debe aparecer en la respuesta");
    assert.ok(!/"payer"\s*:|"card"\s*:|"authorization_code"\s*:|"access_token"\s*:|"refresh_token"\s*:/i.test(serialized));

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// 3) Solo lectura: la Sale, la MercadoPagoConnection y los Tickets nunca
// cambian, ni siquiera si Mercado Pago reporta un payment "approved".
// ==================================================================

testWithDb("is strictly read-only: never confirms the Sale, never creates a Ticket, never modifies the MercadoPagoConnection, even when Mercado Pago reports an approved payment", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const sale = await createRealFailedCheckout(fixture);

    const saleBefore = await prisma.sale.findUnique({ where: { id: sale.id } });
    const connectionBefore = await prisma.mercadoPagoConnection.findUnique({ where: { id: connection.id } });
    const ticketCountBefore = await prisma.ticket.count({ where: { saleId: sale.id } });

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/merchant_orders/search")) {
            return jsonResponse(200, {
                elements: [
                    {
                        id: 1,
                        status: "closed",
                        preference_id: sale.mercadoPagoPreferenceId,
                        external_reference: sale.mercadoPagoExternalReference,
                        paid_amount: 10000,
                        total_amount: 10000,
                        cancelled: false,
                        payments: [
                            rawPaymentWithSensitiveExtras({
                                status: "approved",
                                status_detail: "accredited",
                                external_reference: sale.mercadoPagoExternalReference,
                                collector_id: connection.mercadoPagoUserId,
                                date_approved: "2026-08-19T10:05:00.000Z",
                            }),
                        ],
                    },
                ],
            });
        }
        if (String(url).includes("/v1/payments/search")) return jsonResponse(200, { results: [] });
        throw new Error(`unexpected fetch call to ${url}`);
    });

    let result;
    try {
        result = await getMercadoPagoSaleDiagnosticsService(sale.id);
    } finally {
        restore();
    }

    // La herramienta SÍ ve el "approved" (para eso es el diagnóstico)...
    assert.equal(result.merchantOrders[0].payments[0].status, "approved");

    // ...pero nada de la base cambió.
    const saleAfter = await prisma.sale.findUnique({ where: { id: sale.id } });
    const connectionAfter = await prisma.mercadoPagoConnection.findUnique({ where: { id: connection.id } });
    const ticketCountAfter = await prisma.ticket.count({ where: { saleId: sale.id } });

    assert.deepEqual(saleAfter, saleBefore, "la Sale no debe cambiar en absoluto");
    assert.deepEqual(connectionAfter, connectionBefore, "la MercadoPagoConnection no debe cambiar en absoluto (ni siquiera accessTokenExpiresAt/updatedAt)");
    assert.equal(ticketCountAfter, ticketCountBefore);
    assert.equal(ticketCountAfter, 0);
    assert.equal(saleAfter.status, "PENDING");
    assert.equal(saleAfter.mercadoPagoPaymentId, null);
    assert.equal(saleAfter.paymentRef, null);

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// 4) Casos sin llamar a Mercado Pago — Sale inexistente, Sale MANUAL,
// Organization sin conexión ACTIVE.
// ==================================================================

testWithDb("throws SALE_NOT_FOUND for a saleId that doesn't exist, without contacting Mercado Pago", async () => {
    let fetchCalled = false;
    const restore = mockMpFetch(async () => {
        fetchCalled = true;
        throw new Error("should never be called");
    });
    try {
        await assert.rejects(
            () => getMercadoPagoSaleDiagnosticsService("nonexistent-sale-id"),
            (error) => {
                assert.equal(error.code, "SALE_NOT_FOUND");
                return true;
            }
        );
    } finally {
        restore();
    }
    assert.equal(fetchCalled, false);
});

testWithDb("a MANUAL sale returns NOT_MERCADOPAGO_SALE immediately, without contacting Mercado Pago", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const buyer = await prisma.user.create({ data: { clerkId: `clerk_${uniqueSuffix()}`, email: `buyer_${uniqueSuffix()}@example.com`, firstName: "Comprador", role: "CUSTOMER" } });
    const sale = await prisma.sale.create({
        data: {
            status: "PENDING",
            origin: "SALE",
            paymentMethod: "MANUAL",
            buyerId: buyer.id,
            eventId: fixture.event.id,
            functionId: fixture.eventFunction.id,
            total: 10000,
            publicRecoveryToken: randomUUID(),
        },
    });

    let fetchCalled = false;
    const restore = mockMpFetch(async () => {
        fetchCalled = true;
        throw new Error("should never be called");
    });
    let result;
    try {
        result = await getMercadoPagoSaleDiagnosticsService(sale.id);
    } finally {
        restore();
    }

    assert.equal(fetchCalled, false);
    assert.deepEqual(result.connection, { resolved: false, reason: "NOT_MERCADOPAGO_SALE" });
    assert.deepEqual(result.merchantOrders, []);
    assert.deepEqual(result.payments, []);

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
});

testWithDb("an organization with no ACTIVE connection returns NOT_CONNECTED immediately, without contacting Mercado Pago", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    // La conexión tiene que estar ACTIVE para poder crear el checkout (si
    // no, ni siquiera se hubiera podido crear la preferencia) — recién se
    // desconecta DESPUÉS, simulando el caso real: la Sale se creó bien,
    // pero para cuando se pide el diagnóstico la organización ya se
    // desconectó.
    const connection = await createMpConnection(org.id);
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const sale = await createRealFailedCheckout(fixture);
    await prisma.mercadoPagoConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED" } });

    let fetchCalled = false;
    const restore = mockMpFetch(async () => {
        fetchCalled = true;
        throw new Error("should never be called");
    });
    let result;
    try {
        result = await getMercadoPagoSaleDiagnosticsService(sale.id);
    } finally {
        restore();
    }

    assert.equal(fetchCalled, false);
    assert.deepEqual(result.connection, { resolved: false, reason: "NOT_CONNECTED" });

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// 5) Nunca se loguea el access_token.
// ==================================================================

testWithDb("never logs the access_token used to query Mercado Pago", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-NEVER-LOGGED") });
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const sale = await createRealFailedCheckout(fixture);

    const originalInfo = logger.info;
    const originalWarn = logger.warn;
    const originalError = logger.error;
    const logCalls = [];
    logger.info = (...args) => logCalls.push(args);
    logger.warn = (...args) => logCalls.push(args);
    logger.error = (...args) => logCalls.push(args);

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/merchant_orders/search")) return jsonResponse(200, { elements: [] });
        if (String(url).includes("/v1/payments/search")) return jsonResponse(200, { results: [] });
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        await getMercadoPagoSaleDiagnosticsService(sale.id);
    } finally {
        restore();
        logger.info = originalInfo;
        logger.warn = originalWarn;
        logger.error = originalError;
    }

    const serializedLogs = JSON.stringify(logCalls);
    assert.ok(!serializedLogs.includes("ACCESS-NEVER-LOGGED"));
    assert.ok(!/access.?token/i.test(serializedLogs.replace(/accessTokenExpiresAt/gi, "")));

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// 6) La ruta nunca queda pública — protegida con requireRole("DEVELOPER").
// ==================================================================

testWithDb("the route is protected: requireRole('DEVELOPER') blocks an ORGANIZER from reaching the diagnostics controller", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = { headers: {}, params: { id: "whatever" } };
        let statusCode;
        let jsonBody;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                jsonBody = body;
                return this;
            },
        };
        let nextCalled = false;

        req.auth = Object.assign(() => ({ userId: organizer.clerkId, tokenType: "session_token" }), {
            [Symbol.for("@clerk/express.auth")]: true,
        });

        const middleware = requireRole("DEVELOPER");
        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false, "un ORGANIZER nunca debe llegar al controller de diagnóstico");
        assert.equal(statusCode, 403);
        assert.ok(jsonBody?.message);
    } finally {
        await cleanup({ organizationIds: [], userIds: [organizer.id] });
    }
});

testWithDb("a DEVELOPER can reach the controller, which returns exactly what the service returns, and it is exported/wired correctly", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const fixture = await createEventWithTicketType(org.id, owner.id);
    const sale = await createRealFailedCheckout(fixture);

    const req = { headers: {}, params: { id: sale.id } };
    let statusCode;
    let jsonBody;
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            jsonBody = body;
            return this;
        },
    };
    req.auth = Object.assign(() => ({ userId: developer.clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });

    const middleware = requireRole("DEVELOPER");
    let nextCalled = false;
    await middleware(req, res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true, "un DEVELOPER sí debe poder llegar al controller");

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/merchant_orders/search")) return jsonResponse(200, { elements: [] });
        if (String(url).includes("/v1/payments/search")) return jsonResponse(200, { results: [] });
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        await getMercadoPagoSaleDiagnostics(req, res, () => {});
    } finally {
        restore();
    }

    assert.equal(statusCode, 200);
    assert.equal(jsonBody.sale.id, sale.id);

    await cleanup({ eventIds: [fixture.event.id], organizationIds: [org.id], userIds: [owner.id, developer.id] });
});
