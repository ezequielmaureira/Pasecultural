import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { processMercadoPagoWebhookNotification } from "../src/services/mercadoPagoWebhook.service.js";
import { confirmMercadoPagoPaymentIfEligible } from "../src/services/mercadoPagoPaymentConfirmation.service.js";
import {
    reconcileMercadoPagoSaleService,
    reconcilePendingMercadoPagoSalesService,
    findMercadoPagoReconciliationCandidateSaleIds,
} from "../src/services/mercadoPagoReconciliation.service.js";
import { encryptMercadoPagoSecret, decryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";

// Ronda "recuperación de pagos" — CRUD + transacciones + concurrencia real
// contra Postgres real (backend/.env.test), mismo criterio que
// mercadoPagoWebhook.service.test.js (que este archivo complementa, sin
// duplicar sus casos: acá sólo lo específico de descubrimiento/reconciliación
// — la validación económica en sí ya está probada exhaustivamente ahí y en
// mercadoPagoPaymentConfirmation.service.js la comparten los dos).
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.FRONTEND_URL = "https://pasecultural.test";
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");

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

async function createEventWithTicketType(organizationId, createdBy, { price = 10000, quantity = 100, maxPerPurchase = 10, ticketTypeName = "General" } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: ticketTypeName, price, quantity, maxPerPurchase } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.scanAttempt.deleteMany({ where: { eventId: { in: eventIds } } });
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

async function setupPendingSale({ event, eventFunction, ticketType, quantity = 1 }) {
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            return jsonResponse(201, { id: `PREF-${uniqueSuffix()}`, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" });
        }
        throw new Error(`unexpected fetch during setup: ${url}`);
    });
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Nadia", lastName: "Compradora", email: `buyer_${uniqueSuffix()}@example.com` },
            { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity }], buyerDocument: "30111222" },
            randomUUID()
        );
        return prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
    } finally {
        restore();
    }
}

// Backdatea stockReservedUntil directamente en la base — createSaleForBuyer
// siempre reserva 15 minutos desde "ahora", así que para simular una reserva
// vencida (el escenario real de reconciliación) hay que retroceder el reloj
// a mano, exactamente como haría el paso del tiempo real.
async function expireReservation(saleId, msAgo = 21 * 60 * 1000) {
    await prisma.sale.update({ where: { id: saleId }, data: { stockReservedUntil: new Date(Date.now() - msAgo) } });
}

function paymentPayload(sale, connection, overrides = {}) {
    return {
        id: overrides.id ?? Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000),
        status: "approved",
        status_detail: "accredited",
        transaction_amount: Number(sale.total),
        currency_id: "ARS",
        external_reference: sale.mercadoPagoExternalReference,
        collector_id: connection.mercadoPagoUserId,
        ...overrides,
    };
}

// Router de fetch para todo lo que la reconciliación puede llamar:
// /checkout/preferences (setup), /merchant_orders/search, /v1/payments/search
// y /v1/payments/{id} (la consulta autoritativa final, siempre server-to-server).
// `restrictSearchToToken`: si se pasa, /merchant_orders/search y
// /v1/payments/search sólo devuelven resultados cuando el request llega con
// ESE Bearer token exacto — igual que Mercado Pago real (los resultados de
// búsqueda están scoped a la cuenta dueña del access_token usado, nunca
// devuelven datos de otra cuenta). Sin este parámetro, se ignora el token
// (alcanza para los tests de una sola conexión).
function mockReconciliationFetch({ merchantOrdersByPrefId = {}, searchPaymentsByExtRef = {}, paymentsById = {}, restrictSearchToToken = null } = {}) {
    return mockMpFetch(async (url, options) => {
        const u = String(url);
        const authHeader = options?.headers?.Authorization ?? options?.headers?.get?.("Authorization");
        const requestToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/, "") : null;
        const tokenAllowed = !restrictSearchToToken || requestToken === restrictSearchToToken;

        if (u.includes("/checkout/preferences")) {
            return jsonResponse(201, { id: `PREF-${uniqueSuffix()}`, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" });
        }
        if (u.includes("/merchant_orders/search")) {
            const prefId = new URL(u).searchParams.get("preference_id");
            return jsonResponse(200, { elements: tokenAllowed ? merchantOrdersByPrefId[prefId] ?? [] : [] });
        }
        if (u.includes("/v1/payments/search")) {
            const extRef = new URL(u).searchParams.get("external_reference");
            return jsonResponse(200, { results: tokenAllowed ? searchPaymentsByExtRef[extRef] ?? [] : [] });
        }
        if (u.includes("/v1/payments/")) {
            const id = decodeURIComponent(u.split("/v1/payments/")[1]);
            const payment = paymentsById[id];
            if (!payment) return jsonResponse(404, { message: "not found" });
            return jsonResponse(200, payment);
        }
        throw new Error(`unexpected fetch call to ${u}`);
    });
}

function merchantOrderWith(sale, payments) {
    return { id: `MO-${uniqueSuffix()}`, preference_id: sale.mercadoPagoPreferenceId, external_reference: sale.mercadoPagoExternalReference, payments };
}

// ==================================================================
// 1) recuperación exitosa — el sweep automático descubre un payment
// approved (vía merchant_order) para una Sale con la reserva vencida y la
// confirma, tageada RECONCILIATION_AUTO.
// ==================================================================

testWithDb("1) automatic sweep discovers an approved payment via merchant_order search and reconciles the Sale (RECONCILIATION_AUTO)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 10000 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const payment = paymentPayload(sale, connection);
    const restore = mockReconciliationFetch({
        merchantOrdersByPrefId: { [sale.mercadoPagoPreferenceId]: [merchantOrderWith(sale, [payment])] },
        paymentsById: { [String(payment.id)]: payment },
    });
    try {
        const candidates = await findMercadoPagoReconciliationCandidateSaleIds();
        assert.ok(candidates.includes(sale.id), "la Sale con reserva vencida debe ser candidata");

        // No se asume que ESTA es la única Sale candidata del entorno de test
        // (podría haber otras filas de otros archivos/corridas) — se busca
        // específicamente el resultado de la propia Sale dentro del resumen,
        // en vez de asumir un total global exacto.
        const summary = await reconcilePendingMercadoPagoSalesService();
        const ownResult = summary.results.find((r) => r.saleId === sale.id);
        assert.equal(ownResult?.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(payment.id));
        assert.equal(confirmed.confirmationSource, "RECONCILIATION_AUTO");

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 2) reconciliación manual, repetida N veces -> idempotente, sin duplicar
// nada, tageada RECONCILIATION_MANUAL.
// ==================================================================

testWithDb("2) manual reconciliation repeated 3 times stays idempotent (RECONCILIATION_MANUAL), never duplicates the Ticket", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const payment = paymentPayload(sale, connection);
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [payment] },
        paymentsById: { [String(payment.id)]: payment },
    });
    try {
        const outcomes = [];
        for (let i = 0; i < 3; i += 1) {
            outcomes.push(await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" }));
        }
        assert.equal(outcomes[0].action, "confirmed");
        assert.ok(outcomes.slice(1).every((o) => o.action === "already_confirmed"));

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.confirmationSource, "RECONCILIATION_MANUAL");

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 3) webhook y reconciliación concurrentes sobre el MISMO payment -> una
// única confirmación efectiva.
// ==================================================================

testWithDb("3) webhook and manual reconciliation racing on the same payment produce exactly one confirmation", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const payment = paymentPayload(sale, connection);
    // paymentRef ya conocido (simula que el webhook detectó el candidato una
    // vez, o que Developer > Ventas ya lo tiene marcado) — así ambos caminos
    // apuntan al MISMO paymentId sin depender de mockear el descubrimiento.
    await prisma.sale.update({ where: { id: sale.id }, data: { paymentRef: String(payment.id) } });

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, payment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const [webhookOutcome, reconcileOutcome] = await Promise.all([
            processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId }),
            reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" }),
        ]);

        const actions = [webhookOutcome.action, reconcileOutcome.action].sort();
        assert.deepEqual(actions, ["already_confirmed", "confirmed"]);

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "nunca se duplica el Ticket bajo concurrencia real");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 4) Sale ya CONFIRMED -> reconciliación es no-op seguro.
// ==================================================================

testWithDb("4) reconciling an already-CONFIRMED Sale is a safe no-op (already_confirmed, no new Ticket)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, payment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const webhookOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(webhookOutcome.action, "confirmed");

        const reconcileOutcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(reconcileOutcome.action, "already_confirmed");

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 5/6) payment pending / rejected -> nunca se descubre como candidato
// aprobado, la Sale queda tal cual.
// ==================================================================

testWithDb("5) a payment still pending is never picked up as an approved candidate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const pendingPayment = paymentPayload(sale, connection, { status: "pending" });
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [pendingPayment] },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "no_approved_payment_found");

        const stillPending = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(stillPending.status, "PENDING");
        assert.equal(stillPending.mercadoPagoPaymentId, null);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("6) a rejected payment is never picked up as an approved candidate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const rejectedPayment = paymentPayload(sale, connection, { status: "rejected" });
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [rejectedPayment] },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "no_approved_payment_found");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 7/8/9) monto/moneda/collector incorrectos en la consulta AUTORITATIVA
// (GET /v1/payments/{id}) -> rechazado aunque la búsqueda lo haya listado
// como approved.
// ==================================================================

testWithDb("7) amount mismatch on the authoritative GET rejects the candidate, Sale stays PENDING", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 10000 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const listedPayment = paymentPayload(sale, connection);
    const authoritativePayment = { ...listedPayment, transaction_amount: Number(sale.total) + 1 };
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [listedPayment] },
        paymentsById: { [String(listedPayment.id)]: authoritativePayment },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "AMOUNT_MISMATCH");

        const stillPending = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(stillPending.status, "PENDING");
        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 0);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("8) currency mismatch on the authoritative GET rejects the candidate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const listedPayment = paymentPayload(sale, connection);
    const authoritativePayment = { ...listedPayment, currency_id: "USD" };
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [listedPayment] },
        paymentsById: { [String(listedPayment.id)]: authoritativePayment },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "CURRENCY_MISMATCH");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("9) collector_id mismatch on the authoritative GET rejects the candidate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const listedPayment = paymentPayload(sale, connection);
    const authoritativePayment = { ...listedPayment, collector_id: "someone-else" };
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [listedPayment] },
        paymentsById: { [String(listedPayment.id)]: authoritativePayment },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "COLLECTOR_MISMATCH");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 10) external_reference incorrecto en la consulta autoritativa -> ningún
// Sale corresponde, se rechaza sin confirmar nada.
// ==================================================================

testWithDb("10) a payment whose authoritative external_reference matches no Sale is rejected (SALE_NOT_FOUND)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const payment = paymentPayload(sale, connection, { external_reference: `orphan-${uniqueSuffix()}` });
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, payment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const outcome = await confirmMercadoPagoPaymentIfEligible({
            paymentId: payment.id,
            candidateConnectionId: connection.id,
            source: "RECONCILIATION_MANUAL",
        });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "SALE_NOT_FOUND");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 11) Organization incorrecta -> la Sale resuelta pertenece a otra
// organización que la usada para consultar el payment.
// ==================================================================

testWithDb("11) a payment resolved under organization A's connection but pointing at organization B's Sale is rejected (ORGANIZATION_MISMATCH)", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const connectionA = await createMpConnection(orgA.id);
    const { event: eventA, eventFunction: fnA, ticketType: ttA } = await createEventWithTicketType(orgA.id, ownerA.id);

    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    await createMpConnection(orgB.id);
    const { event: eventB, eventFunction: fnB, ticketType: ttB } = await createEventWithTicketType(orgB.id, ownerB.id);
    const saleB = await setupPendingSale({ event: eventB, eventFunction: fnB, ticketType: ttB, quantity: 1 });

    // Payment real de la cuenta A (collector_id = A), pero su external_reference
    // (por bug/manipulación defensiva) apunta a una Sale de la organización B.
    const payment = paymentPayload(saleB, connectionA, { collector_id: connectionA.mercadoPagoUserId });
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, payment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const outcome = await confirmMercadoPagoPaymentIfEligible({
            paymentId: payment.id,
            candidateConnectionId: connectionA.id,
            source: "RECONCILIATION_MANUAL",
        });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "ORGANIZATION_MISMATCH");

        const untouched = await prisma.sale.findUnique({ where: { id: saleB.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [eventA.id, eventB.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
    }
});

// ==================================================================
// 13) stockReservedUntil todavía vigente -> nunca es candidata al sweep
// automático (podría estar en curso).
// ==================================================================

testWithDb("13) a Sale whose reservation window is still active is never a reconciliation candidate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    try {
        const candidates = await findMercadoPagoReconciliationCandidateSaleIds();
        assert.ok(!candidates.includes(sale.id), "una reserva todavía vigente nunca debe ser candidata");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 14) stockReservedUntil vencido pero el stock TODAVÍA está disponible ->
// confirma normalmente (el chequeo real es capacidad, no el timestamp
// nominal de reserva).
// ==================================================================

testWithDb("14) an expired reservation with stock still available confirms normally", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 5 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const payment = paymentPayload(sale, connection);
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [payment] },
        paymentsById: { [String(payment.id)]: payment },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_AUTO" });
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 15) CASO CRÍTICO — stockReservedUntil vencido y el stock YA fue tomado
// por otra Sale confirmada -> nunca sobrevende: approved_but_no_stock, sin
// Ticket, paymentRef persistido para reintentar.
// ==================================================================

testWithDb("15) an expired reservation whose stock was already taken never oversells (approved_but_no_stock, no Ticket)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    // Un único lugar disponible. Orden real del incidente: la Sale que
    // "llega tarde" se creó (y reservó) PRIMERO — su reserva vence sin que
    // el webhook la haya confirmado, deja de contar como indisponible
    // (getUnavailableCount), y RECIÉN AHÍ otra Sale puede reservar y
    // confirmar ese mismo lugar. Si se creara al revés (ganadora primero),
    // la reserva de la ganadora ya ocuparía el único lugar y la Sale tardía
    // ni siquiera podría crearse — no reproduciría el escenario real.
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 1, maxPerPurchase: 1 });

    const lateSale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(lateSale.id);
    const latePayment = paymentPayload(lateSale, connection);

    const winnerSale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const winnerPayment = paymentPayload(winnerSale, connection);
    const restoreWinner = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, winnerPayment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    const winnerOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: winnerPayment.id, bodyUserId: connection.mercadoPagoUserId });
    restoreWinner();
    assert.equal(winnerOutcome.action, "confirmed");
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [lateSale.mercadoPagoExternalReference]: [latePayment] },
        paymentsById: { [String(latePayment.id)]: latePayment },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(lateSale.id, { source: "RECONCILIATION_AUTO" });
        assert.equal(outcome.action, "approved_but_no_stock");

        const stillPending = await prisma.sale.findUnique({ where: { id: lateSale.id } });
        assert.equal(stillPending.status, "PENDING", "nunca se confirma sin stock real");
        assert.equal(stillPending.paymentRef, String(latePayment.id));
        assert.equal(stillPending.mercadoPagoPaymentId, null, "nunca se reclama el paymentId sin haber confirmado de verdad");

        const lateTicketCount = await prisma.ticket.count({ where: { saleId: lateSale.id } });
        assert.equal(lateTicketCount, 0, "nunca se sobrevende");

        const totalActiveTickets = await prisma.ticket.count({ where: { eventId: event.id, status: "ACTIVE" } });
        assert.equal(totalActiveTickets, 1, "el único lugar disponible sigue siendo del comprador que llegó primero");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 17) múltiples intentos de pago sobre la MISMA preferencia — uno
// rejected, otro approved después -> se selecciona ÚNICAMENTE el approved.
// ==================================================================

testWithDb("17) multiple payment attempts on the same preference (rejected then approved) select only the approved one", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const rejectedAttempt = paymentPayload(sale, connection, { status: "rejected", id: 111111111 });
    const approvedAttempt = paymentPayload(sale, connection, { status: "approved", id: 222222222 });
    const restore = mockReconciliationFetch({
        merchantOrdersByPrefId: { [sale.mercadoPagoPreferenceId]: [merchantOrderWith(sale, [rejectedAttempt, approvedAttempt])] },
        paymentsById: { [String(approvedAttempt.id)]: approvedAttempt },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.mercadoPagoPaymentId, String(approvedAttempt.id));
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 18) dos payments approved para la MISMA Sale/preferencia -> ambigüedad,
// NUNCA se confirma automáticamente.
// ==================================================================

testWithDb("18) two distinct approved payments for the same Sale/preference never auto-confirm (ambiguous_approved_payments)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    const approvedA = paymentPayload(sale, connection, { status: "approved", id: 333333333 });
    const approvedB = paymentPayload(sale, connection, { status: "approved", id: 444444444 });
    const restore = mockReconciliationFetch({
        merchantOrdersByPrefId: { [sale.mercadoPagoPreferenceId]: [merchantOrderWith(sale, [approvedA, approvedB])] },
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "ambiguous_approved_payments");
        assert.equal(outcome.candidateCount, 2);

        const stillPending = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(stillPending.status, "PENDING", "nunca se asume cuál payment es el correcto");
        assert.equal(stillPending.mercadoPagoPaymentId, null);
        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 0);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 19) confirmationSource=WEBHOOK para el camino normal — confirma que los
// tres orígenes quedan correctamente distinguidos en la base.
// ==================================================================

testWithDb("19) a normal webhook confirmation is tagged confirmationSource=WEBHOOK", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return jsonResponse(200, payment);
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.confirmationSource, "WEBHOOK");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 20) descubrimiento prueba conexiones DISCONNECTED como fallback — la
// organización desconectó la cuenta que hizo el pago y conectó otra
// distinta antes de que la reconciliación corriera.
// ==================================================================

testWithDb("20) discovery falls back to a DISCONNECTED connection when the payment isn't found under the current ACTIVE one", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const oldConnection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await expireReservation(sale.id);

    // La organización desconecta la cuenta vieja y conecta una nueva —
    // mismo mecanismo que mercadoPagoConnection.service.js (nunca se borra
    // la fila vieja, sólo pasa a DISCONNECTED).
    await prisma.mercadoPagoConnection.update({ where: { id: oldConnection.id }, data: { status: "DISCONNECTED", disconnectedAt: new Date() } });
    await createMpConnection(org.id); // nueva ACTIVE, sin ningún payment de esta Sale

    const payment = paymentPayload(sale, oldConnection);
    // El payment sólo es "encontrable" con el token de la cuenta VIEJA —
    // igual que Mercado Pago real, cuya búsqueda está scoped a la cuenta
    // dueña del access_token. Si el descubrimiento se quedara sólo con la
    // conexión ACTIVE actual (la nueva, que nunca vio este pago), nunca lo
    // encontraría — este test demuestra el fallback a DISCONNECTED.
    const oldConnectionToken = decryptMercadoPagoSecret(oldConnection.accessTokenEncrypted);
    const restore = mockReconciliationFetch({
        searchPaymentsByExtRef: { [sale.mercadoPagoExternalReference]: [payment] },
        paymentsById: { [String(payment.id)]: payment },
        restrictSearchToToken: oldConnectionToken,
    });
    try {
        const outcome = await reconcileMercadoPagoSaleService(sale.id, { source: "RECONCILIATION_MANUAL" });
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
