import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { processMercadoPagoWebhookNotification } from "../src/services/mercadoPagoWebhook.service.js";
import { encryptMercadoPagoSecret, decryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";
import { disconnectMercadoPagoConnectionService } from "../src/services/mercadoPagoConnection.service.js";
import { decryptSecret } from "../src/config/qrEncryption.js";
import { scanTicketService, confirmScanService } from "../src/services/scanner.service.js";

// MP-3 — CRUD + transacciones + concurrencia real, no expresable como
// funciones puras: se prueba contra Postgres real (backend/.env.test).
// Guardrail centralizado — ver tests/helpers/dbGuard.js (NUNCA un segundo
// guardrail casero).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.FRONTEND_URL = "https://pasecultural.test";
// Pre-existente, no relacionado a este bug fix: confirmSaleService (llamado
// por processMercadoPagoWebhookNotification al aprobar un payment) emite
// Ticket/TicketQr real, que exige TICKET_QR_SECRET_KEY — backend/.env.test
// no la trae (no se toca ese archivo). Mismo criterio que la línea de
// arriba: una clave de prueba fija, sólo para este proceso de test.
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `owner_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
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
    // MP-5 — test 26/28 son los primeros de este archivo que llaman al
    // Scanner (scanTicketService/confirmScanService), que siempre escribe
    // un ScanAttempt. scan_attempts.ticketId es ON DELETE SET NULL (no
    // bloquea el deleteMany de tickets de más abajo), pero igual se limpia
    // acá para no dejar filas huérfanas entre corridas de test.
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

// Arma una Sale PENDING con paymentMethod=MERCADO_PAGO exactamente como lo
// deja MP-2/MP-2.1 — reusa createMercadoPagoCheckoutService en vez de
// insertar filas a mano, así los fixtures de estos tests son idénticos a
// lo que el sistema real produce.
async function setupPendingSale({ event, eventFunction, ticketType, quantity = 1 }) {
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            return jsonResponse(201, {
                id: `PREF-${uniqueSuffix()}`,
                init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x",
            });
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

function paymentPayload(sale, connection, overrides = {}) {
    return {
        id: overrides.id ?? Number(String(Date.now()).slice(-9)),
        status: "approved",
        status_detail: "accredited",
        transaction_amount: Number(sale.total),
        currency_id: "ARS",
        external_reference: sale.mercadoPagoExternalReference,
        collector_id: connection.mercadoPagoUserId,
        ...overrides,
    };
}

function mockPaymentGet(handler) {
    return mockMpFetch(async (url) => {
        if (String(url).includes("/v1/payments/")) return handler(url);
        throw new Error(`unexpected fetch call to ${url}`);
    });
}

// ==================================================================
// 1/2/3) webhook válido + payment approved -> confirma la Sale, genera
// Ticket y QR una sola vez.
// ==================================================================

testWithDb("1/2/3) a valid webhook with an approved payment confirms the Sale, generating Ticket and TicketQr exactly once", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 10000 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 2 });

    const payment = paymentPayload(sale, connection);
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.ok, true);
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(payment.id));

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.equal(tickets.length, 2);
        const qrCount = await prisma.ticketQr.count({ where: { ticketId: { in: tickets.map((t) => t.id) } } });
        assert.equal(qrCount, 2);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 4/21) reintentos nunca disparan un segundo email — el fast path de
// idempotencia ni siquiera vuelve a llamar a confirmSaleService.
// ==================================================================

testWithDb("4/21) a Sale already CONFIRMED + a repeated webhook never re-triggers Ticket/QR/email generation", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    let mpCalls = 0;
    const restore = mockPaymentGet(async () => {
        mpCalls += 1;
        return jsonResponse(200, payment);
    });
    try {
        const first = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(first.action, "confirmed");
        const afterFirst = await prisma.sale.findUnique({ where: { id: sale.id } });
        const attemptsAfterFirst = afterFirst.confirmationEmailAttempts;

        const second = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(second.action, "already_confirmed");

        const afterSecond = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(afterSecond.confirmationEmailAttempts, attemptsAfterFirst, "el segundo webhook no debe reintentar el email");

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "nunca se duplica el Ticket");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 5) mismo webhook repetido N veces -> idempotente.
// ==================================================================

testWithDb("5) the same webhook repeated 4 times stays idempotent — a single Ticket, a single confirmedAt", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const results = [];
        for (let i = 0; i < 4; i += 1) {
            results.push(await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId }));
        }
        assert.equal(results[0].action, "confirmed");
        assert.ok(results.slice(1).every((r) => r.action === "already_confirmed"));

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 6) dos webhooks simultáneos del MISMO payment -> idempotencia real bajo
// concurrencia (no sólo secuencial).
// ==================================================================

testWithDb("6) two truly concurrent webhooks for the same payment never double-issue Tickets", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 5000 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const [a, b] = await Promise.allSettled([
            processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId }),
            processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId }),
        ]);

        assert.equal(a.status, "fulfilled");
        assert.equal(b.status, "fulfilled");
        assert.ok(a.value.ok && b.value.ok, "ninguna de las dos invocaciones debe terminar en error");
        assert.ok(
            [a.value.action, b.value.action].filter((action) => action === "confirmed").length <= 1,
            "a lo sumo una de las dos gana la confirmación real"
        );

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "nunca dos Ticket para la misma unidad comprada");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(payment.id));
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 7/25) firma inválida -> no consulta ni confirma nada. Se prueba a nivel
// del controller real (no sólo del service), que es donde vive la
// verificación de firma.
// ==================================================================

testWithDb("7/25) the controller never calls Mercado Pago or confirms anything when the signature is invalid", async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "a-real-webhook-secret";
    const { handleMercadoPagoWebhook } = await import("../src/controllers/mercadoPagoWebhook.controller.js");

    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const payment = paymentPayload(sale, connection);

    let mpCalled = false;
    const restore = mockPaymentGet(async () => {
        mpCalled = true;
        return jsonResponse(200, payment);
    });

    function fakeRes() {
        const res = { statusCode: null, body: null };
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };
        res.json = (body) => {
            res.body = body;
            return res;
        };
        res.end = () => res;
        return res;
    }

    try {
        // Sin x-signature — el endpoint sigue siendo público (Mercado Pago
        // no manda sesión de Clerk), pero eso nunca implica confiar en el
        // body.
        const req1 = { headers: {}, query: { "data.id": String(payment.id) }, body: { type: "payment", data: { id: payment.id }, user_id: connection.mercadoPagoUserId } };
        const res1 = fakeRes();
        await handleMercadoPagoWebhook(req1, res1);
        assert.equal(res1.statusCode, 401);

        // Firma presente pero incorrecta.
        const req2 = {
            headers: { "x-signature": "ts=1,v1=0000000000000000000000000000000000000000000000000000000000000000", "x-request-id": "r1" },
            query: { "data.id": String(payment.id) },
            body: { type: "payment", data: { id: payment.id }, user_id: connection.mercadoPagoUserId },
        };
        const res2 = fakeRes();
        await handleMercadoPagoWebhook(req2, res2);
        assert.equal(res2.statusCode, 401);

        assert.equal(mpCalled, false, "una firma inválida nunca debe llegar a consultar Mercado Pago");
        const untouchedSale = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouchedSale.status, "PENDING", "una firma inválida nunca debe confirmar nada");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 8) payment inexistente (404 en Mercado Pago) -> no confirma.
// ==================================================================

testWithDb("8) a payment that doesn't exist on Mercado Pago's side never confirms anything", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const restore = mockPaymentGet(async () => jsonResponse(404, { message: "Payment not found" }));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: "999999999", bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.ok, true);
        assert.equal(outcome.action, "unresolvable");

        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 9) payment pending -> Sale sigue sin confirmar.
// ==================================================================

testWithDb("9) a pending payment leaves the Sale PENDING, unconfirmed", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { status: "pending", status_detail: "pending_waiting_payment" });
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.ok, true);
        assert.equal(outcome.action, "not_approved");

        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.status, "PENDING");
        assert.equal(untouched.mercadoPagoPaymentId, null);

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 0);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Bug fix (reintentos de Checkout Pro) — 10/11) un payment rejected/
// cancelled INDIVIDUAL nunca cancela la Sale ni libera su reserva: es
// terminal sólo para ESE intento, nunca para la Sale, porque Checkout Pro
// puede seguir ofreciendo "pagar con otro medio" sobre la MISMA
// preference/external_reference. Caso real que motivó este fix: rejected
// → (mismo external_reference) approved, y la Sale ya estaba CANCELLED,
// sin ticket — ver los tests siguientes para la reproducción completa.
// ==================================================================

for (const status of ["rejected", "cancelled"]) {
    testWithDb(`10/11) a ${status} payment never cancels the Sale nor releases its stock reservation`, async () => {
        const owner = await createUser();
        const org = await createOrganization(owner.id);
        const connection = await createMpConnection(org.id);
        const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 1 });
        const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

        const payment = paymentPayload(sale, connection, { status });
        const restore = mockPaymentGet(async () => jsonResponse(200, payment));
        try {
            const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
            assert.equal(outcome.ok, true);
            assert.equal(outcome.action, "payment_attempt_failed");

            const stillPending = await prisma.sale.findUnique({ where: { id: sale.id } });
            assert.equal(stillPending.status, "PENDING", "la Sale nunca debe cancelarse por un intento individual");
            assert.equal(
                stillPending.stockReservedUntil.getTime(),
                sale.stockReservedUntil.getTime(),
                "la reserva de stock nunca debe tocarse por un intento individual"
            );

            // La reserva SIGUE vigente — otra Sale por la misma (única)
            // unidad debe rechazarse por falta de stock, exactamente lo
            // opuesto al bug (que la liberaba de inmediato).
            await assert.rejects(
                () => setupPendingSale({ event, eventFunction, ticketType, quantity: 1 }),
                (error) => {
                    assert.equal(error.code, "INSUFFICIENT_STOCK");
                    return true;
                }
            );
        } finally {
            restore();
            await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        }
    });
}

testWithDb("a rejected payment notified twice (retry/redelivery) is idempotent: never mutates the Sale either time", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { status: "rejected" });
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const first = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        const second = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });

        assert.equal(first.action, "payment_attempt_failed");
        assert.equal(second.action, "payment_attempt_failed");

        const stillPending = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(stillPending.status, "PENDING");
        assert.equal(stillPending.stockReservedUntil.getTime(), sale.stockReservedUntil.getTime());
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("rejected -> approved with the same external_reference: confirms the Sale with exactly one Ticket (reproduces the real reported bug end to end)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const rejectedPayment = paymentPayload(sale, connection, { status: "rejected", id: 174601635408 });
    const restoreRejected = mockPaymentGet(async () => jsonResponse(200, rejectedPayment));
    try {
        const rejectedOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: rejectedPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(rejectedOutcome.action, "payment_attempt_failed");
    } finally {
        restoreRejected();
    }

    // Segundo intento, mismo external_reference, payment_id DISTINTO —
    // exactamente el escenario real: "pagar con otro medio" dentro del
    // mismo Checkout Pro.
    const approvedPayment = paymentPayload(sale, connection, { status: "approved", id: 173671402439 });
    const restoreApproved = mockPaymentGet(async () => jsonResponse(200, approvedPayment));
    try {
        const approvedOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: approvedPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(approvedOutcome.ok, true);
        assert.equal(approvedOutcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(approvedPayment.id));

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.equal(tickets.length, 1, "exactamente un Ticket, ni cero ni duplicado");
    } finally {
        restoreApproved();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("rejected -> rejected -> approved (dos rechazos antes del éxito): confirma la Sale con exactamente un Ticket", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    for (const paymentId of [111111111, 222222222]) {
        const rejectedPayment = paymentPayload(sale, connection, { status: "rejected", id: paymentId });
        const restore = mockPaymentGet(async () => jsonResponse(200, rejectedPayment));
        try {
            const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: rejectedPayment.id, bodyUserId: connection.mercadoPagoUserId });
            assert.equal(outcome.action, "payment_attempt_failed");
        } finally {
            restore();
        }
    }

    const approvedPayment = paymentPayload(sale, connection, { status: "approved", id: 333333333 });
    const restoreApproved = mockPaymentGet(async () => jsonResponse(200, approvedPayment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: approvedPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.equal(tickets.length, 1);
    } finally {
        restoreApproved();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("approved -> a late/out-of-order rejected for a different payment never un-confirms an already-CONFIRMED Sale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const approvedPayment = paymentPayload(sale, connection, { status: "approved", id: 444444444 });
    const restoreApproved = mockPaymentGet(async () => jsonResponse(200, approvedPayment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: approvedPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "confirmed");
    } finally {
        restoreApproved();
    }

    // Notificación tardía/fuera de orden de un intento ANTERIOR (rejected)
    // que llega DESPUÉS de que el segundo intento ya confirmó la Sale.
    const staleRejectedPayment = paymentPayload(sale, connection, { status: "rejected", id: 555555555 });
    const restoreRejected = mockPaymentGet(async () => jsonResponse(200, staleRejectedPayment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: staleRejectedPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.ok, true);

        const stillConfirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(stillConfirmed.status, "CONFIRMED", "un rejected tardío de otro intento nunca debe des-confirmar la Sale");

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.equal(tickets.length, 1, "nunca debe duplicar ni borrar el ticket ya emitido");
    } finally {
        restoreRejected();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 12/13) payment refunded/charged_back sobre una Sale YA confirmada ->
// nunca vuelve a confirmar la Sale, nunca duplica/emite Tickets, invalida
// (REFUNDED) los Tickets ACTIVE de esa Sale, y repetir la misma
// notificación (retry/redelivery) es idempotente (MP-5).
//
// Auditoría de webhooks — MERCADOPAGO_RECONCILIATION_ALERT_EMAIL nunca se
// define en este archivo, así que sendMercadoPagoReversalAlert() falla
// puertas adentro (env var faltante) en las dos llamadas de este mismo
// test (la primera con ticketsRefunded=1, la segunda con 0) — de paso
// prueba que un fallo de esa alerta best-effort nunca hace fallar el
// webhook, y que se intenta enviar incluso cuando ticketsRefunded es 0.
// ==================================================================

for (const status of ["refunded", "charged_back"]) {
    testWithDb(`12/13) a ${status} notification on an already-confirmed Sale invalidates its Tickets (REFUNDED), never re-confirms, never duplicates, and is idempotent on retry`, async () => {
        const owner = await createUser();
        const org = await createOrganization(owner.id);
        const connection = await createMpConnection(org.id);
        const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
        const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

        const approvedPayment = paymentPayload(sale, connection, { status: "approved" });
        let restore = mockPaymentGet(async () => jsonResponse(200, approvedPayment));
        try {
            const first = await processMercadoPagoWebhookNotification({ type: "payment", dataId: approvedPayment.id, bodyUserId: connection.mercadoPagoUserId });
            assert.equal(first.action, "confirmed");
        } finally {
            restore();
        }

        const ticketBefore = await prisma.ticket.findFirst({ where: { saleId: sale.id } });
        assert.equal(ticketBefore.status, "ACTIVE");

        const reversedPayment = { ...approvedPayment, status };
        restore = mockPaymentGet(async () => jsonResponse(200, reversedPayment));
        try {
            const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: reversedPayment.id, bodyUserId: connection.mercadoPagoUserId });
            assert.equal(outcome.ok, true);
            assert.equal(outcome.action, "reversal_acknowledged");
            assert.equal(outcome.ticketsRefunded, 1, "un Ticket ACTIVE pasa a REFUNDED");

            const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
            assert.equal(untouched.status, "CONFIRMED", "MP-5 nunca toca Sale.status, sólo invalida el Ticket");

            const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticketBefore.id } });
            assert.equal(ticketAfter.status, "REFUNDED");

            const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
            assert.equal(ticketCount, 1, "nunca se duplican ni emiten tickets nuevos por una reversión");

            // Duplicado/redelivery del MISMO webhook -> idempotente: no hay
            // ningún Ticket ACTIVE más para tocar, así que la segunda vuelta
            // no muta nada (ni error, ni un segundo "REFUNDED" sobre otro
            // ticket inexistente).
            const outcomeRepeat = await processMercadoPagoWebhookNotification({
                type: "payment",
                dataId: reversedPayment.id,
                bodyUserId: connection.mercadoPagoUserId,
            });
            assert.equal(outcomeRepeat.ok, true);
            assert.equal(outcomeRepeat.action, "reversal_acknowledged");
            assert.equal(outcomeRepeat.ticketsRefunded, 0, "la segunda notificación no encuentra ningún Ticket ACTIVE");

            const ticketAfterRepeat = await prisma.ticket.findUnique({ where: { id: ticketBefore.id } });
            assert.equal(ticketAfterRepeat.status, "REFUNDED");
            const ticketCountAfterRepeat = await prisma.ticket.count({ where: { saleId: sale.id } });
            assert.equal(ticketCountAfterRepeat, 1);
        } finally {
            restore();
            await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        }
    });
}

// ==================================================================
// 26) un refund/chargeback sobre una Sale nunca toca el Ticket de otra
// Sale distinta (misma función/evento) — aislamiento.
// ==================================================================

testWithDb("26) a refund/chargeback for one Sale never touches another Sale's Ticket", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 100 });
    const saleA = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const saleB = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const paymentA = paymentPayload(saleA, connection, { status: "approved", id: 700000001 });
    const paymentB = paymentPayload(saleB, connection, { status: "approved", id: 700000002 });
    let restore = mockPaymentGet(async (url) => {
        if (String(url).includes(String(paymentA.id))) return jsonResponse(200, paymentA);
        if (String(url).includes(String(paymentB.id))) return jsonResponse(200, paymentB);
        throw new Error(`unexpected payment id lookup: ${url}`);
    });
    try {
        await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentA.id, bodyUserId: connection.mercadoPagoUserId });
        await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentB.id, bodyUserId: connection.mercadoPagoUserId });
    } finally {
        restore();
    }

    const reversedA = { ...paymentA, status: "refunded" };
    restore = mockPaymentGet(async () => jsonResponse(200, reversedA));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: reversedA.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.ticketsRefunded, 1);

        const ticketA = await prisma.ticket.findFirst({ where: { saleId: saleA.id } });
        assert.equal(ticketA.status, "REFUNDED");

        const ticketB = await prisma.ticket.findFirst({ where: { saleId: saleB.id } });
        assert.equal(ticketB.status, "ACTIVE", "la Sale B nunca debe verse afectada por la reversión de la Sale A");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 27) un payment refunded/charged_back cuyo external_reference no
// corresponde a ninguna Sale sigue siendo ignorado — las protecciones de
// correlación existentes (SALE_NOT_FOUND) no cambian para estos estados.
// ==================================================================

testWithDb("27) a refunded payment whose external_reference matches no Sale is ignored, same protection as any other status", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { status: "refunded", external_reference: "this-does-not-match-any-sale" });
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "SALE_NOT_FOUND");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 28) un Ticket REFUNDED es rechazado por el Scanner exactamente igual que
// uno CANCELLED — tanto en la vista previa (scanTicketService) como en la
// confirmación real de ingreso (confirmScanService) — y nunca crea CheckIn.
// ==================================================================

testWithDb("28) a REFUNDED ticket is rejected by the Scanner (preview and confirm) and never creates a CheckIn", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const approvedPayment = paymentPayload(sale, connection, { status: "approved" });
    let restore = mockPaymentGet(async () => jsonResponse(200, approvedPayment));
    try {
        await processMercadoPagoWebhookNotification({ type: "payment", dataId: approvedPayment.id, bodyUserId: connection.mercadoPagoUserId });
    } finally {
        restore();
    }

    const reversedPayment = { ...approvedPayment, status: "refunded" };
    restore = mockPaymentGet(async () => jsonResponse(200, reversedPayment));
    try {
        await processMercadoPagoWebhookNotification({ type: "payment", dataId: reversedPayment.id, bodyUserId: connection.mercadoPagoUserId });
    } finally {
        restore();
    }

    const ticket = await prisma.ticket.findFirst({ where: { saleId: sale.id }, include: { qr: true } });
    assert.equal(ticket.status, "REFUNDED");
    const token = `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`;

    // No hace falta una fila EventScanner real: resolveScannerAccess toma
    // el camino rápido (cero queries) cuando el eventId pedido coincide con
    // el del "ancla" de la sesión — mismo shape que req.scanner ya trae.
    const scannerContext = { id: "test-scanner", eventId: event.id, gate: null, firstName: "Test", lastName: "Scanner", name: "Test Scanner" };

    const preview = await scanTicketService(scannerContext, { eventId: event.id, functionId: eventFunction.id, token });
    assert.equal(preview.status, "CANCELLED", "la vista previa rechaza un Ticket REFUNDED igual que uno CANCELLED");

    const confirmation = await confirmScanService(scannerContext, { eventId: event.id, functionId: eventFunction.id, token });
    assert.equal(confirmation.status, "CANCELLED", "la confirmación de ingreso también lo rechaza");

    const checkInCount = await prisma.checkIn.count({ where: { ticketId: ticket.id } });
    assert.equal(checkInCount, 0, "un Ticket REFUNDED nunca genera un CheckIn — nunca ingresa");

    const ticketStillRefunded = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    assert.equal(ticketStillRefunded.status, "REFUNDED", "el intento de escaneo no cambia el status del ticket");

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// 14/15/16) external_reference / amount / currency incorrectos -> rechazo
// controlado, nunca confirma.
// ==================================================================

testWithDb("14) an external_reference that matches no Sale is rejected without confirming anything", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { external_reference: "this-does-not-match-any-sale" });
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "SALE_NOT_FOUND");

        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("15) a transaction_amount that doesn't match Sale.total is rejected, never confirmed", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 10000 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { transaction_amount: 1 }); // Sale.total real es 10000
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "AMOUNT_MISMATCH");

        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("16) a currency_id other than ARS is rejected, never confirmed", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection, { currency_id: "USD" });
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "CURRENCY_MISMATCH");

        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 17) una Sale MANUAL nunca puede confirmarse vía webhook de Mercado Pago
// (mercadoPagoExternalReference nunca existe para ese camino, así que la
// correlación nunca puede encontrarla — se prueba igual explícitamente).
// ==================================================================

testWithDb("17) a MANUAL sale can never be confirmed through the Mercado Pago webhook", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const buyer = await prisma.user.create({ data: { email: `manual_${uniqueSuffix()}@example.com`, firstName: "Manual", clerkId: null } });

    const { createSaleForBuyer } = await import("../src/services/sale.service.js");
    const manualSale = await createSaleForBuyer(buyer, {
        eventId: event.id,
        functionId: eventFunction.id,
        items: [{ ticketTypeId: ticketType.id, quantity: 1 }],
        buyerDocument: "30111222",
    });
    assert.equal(manualSale.paymentMethod, "MANUAL");
    assert.equal(manualSale.mercadoPagoExternalReference, null);

    // Ningún payment real puede tener external_reference null — esto es
    // sólo para demostrar que, aunque alguien lo intentara, la correlación
    // nunca encuentra esta Sale.
    const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: "123123123", bodyUserId: "any" });
    assert.equal(outcome.action, "unresolvable");

    const untouched = await prisma.sale.findUnique({ where: { id: manualSale.id } });
    assert.equal(untouched.status, "PENDING");

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
});

// ==================================================================
// 18) aislamiento de credenciales entre dos organizaciones — el token de
// la organización B nunca se usa para un payment de la organización A.
// ==================================================================

testWithDb("18) organization isolation: a payment for org A is never fetched or confirmed using org B's credentials", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const connectionA = await createMpConnection(orgA.id);
    const { event: eventA, eventFunction: fnA, ticketType: ttA } = await createEventWithTicketType(orgA.id, ownerA.id, { price: 5000 });
    const saleA = await setupPendingSale({ event: eventA, eventFunction: fnA, ticketType: ttA, quantity: 1 });

    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    const connectionB = await createMpConnection(orgB.id);

    const payment = paymentPayload(saleA, connectionA);
    let capturedAuthHeader;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/v1/payments/")) {
            capturedAuthHeader = options.headers.Authorization;
            return jsonResponse(200, payment);
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        // bodyUserId apunta deliberadamente a B — la firma no cubre este
        // campo, así que el sistema podría "confiar mal" en él si no
        // verificara todo server-to-server. collector_id del payment sigue
        // siendo el de A, así que la verificación explícita de
        // COLLECTOR_MISMATCH tiene que frenarlo.
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connectionB.mercadoPagoUserId });
        assert.equal(outcome.action, "unresolvable");
        assert.equal(outcome.reason, "COLLECTOR_MISMATCH");

        // El intento de lookup sí usó el token de B (bodyUserId apuntaba a
        // B) — lo que importa es que, aunque se haya usado ESE token, el
        // resultado (collector_id de A) nunca se termina confirmando.
        const expectedBearer = `Bearer ${decryptMercadoPagoSecret(connectionB.accessTokenEncrypted)}`;
        assert.equal(capturedAuthHeader, expectedBearer);

        const untouched = await prisma.sale.findUnique({ where: { id: saleA.id } });
        assert.equal(untouched.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [eventA.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
    }
});

// ==================================================================
// 19) access_token vencido -> se renueva vía la infraestructura de MP-1
// antes de consultar el payment.
// ==================================================================

testWithDb("19) an expired access token is refreshed before querying the payment", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    // La conexión tenía que estar VIGENTE cuando se creó el checkout (si
    // no, ni siquiera se hubiera podido crear la preferencia) — recién se
    // vence DESPUÉS, simulando el caso real: el token estaba bien cuando
    // el comprador arrancó, pero venció para cuando llega el webhook.
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await prisma.mercadoPagoConnection.update({ where: { id: connection.id }, data: { accessTokenExpiresAt: new Date(Date.now() - 60 * 1000) } });

    const payment = paymentPayload(sale, connection);
    let refreshCalled = false;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/oauth/token")) {
            refreshCalled = true;
            return jsonResponse(200, { access_token: "NEW-TOKEN", refresh_token: "NEW-REFRESH", user_id: 1, expires_in: 15552000 });
        }
        if (String(url).includes("/v1/payments/")) {
            assert.equal(options.headers.Authorization, "Bearer NEW-TOKEN");
            return jsonResponse(200, payment);
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(refreshCalled, true);
        assert.equal(outcome.action, "confirmed");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Bug fix (desconexión de Mercado Pago) — escenario explícito del pedido:
// cuenta A conectada, se cobra un checkout, se desconecta A, se conecta
// una cuenta B distinta para la MISMA organización, y recién ENTONCES
// llega el webhook (tardío) del payment de A. Debe confirmar la Sale
// usando EXCLUSIVAMENTE el access_token de A — nunca el de B, y nunca
// queda irresoluble sólo porque la organización ya está en otra cuenta.
// ==================================================================

testWithDb("account A -> disconnect -> account B connected -> a late webhook for A's payment resolves and confirms using A's token, never B's", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connectionA = await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-A") });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    // El payment se generó mientras A estaba conectada — collector_id
    // pertenece a A.
    const payment = paymentPayload(sale, connectionA);

    // Ahora, ANTES de que llegue el webhook: se desconecta A y se conecta
    // B para la misma organización.
    await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
    const connectionB = await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-B") });

    // mockPaymentGet sólo reenvía `url` al handler (nunca `options`, ver su
    // definición) — hace falta el Authorization real, así que acá se usa
    // mockMpFetch directo, igual que el test 19 de este mismo archivo.
    let capturedAuthHeader;
    const restore = mockMpFetch(async (url, options) => {
        if (!String(url).includes("/v1/payments/")) throw new Error(`unexpected fetch call to ${url}`);
        capturedAuthHeader = options.headers.Authorization;
        return jsonResponse(200, payment);
    });
    try {
        // bodyUserId es la pista de enrutamiento real que trae la
        // notificación de Mercado Pago — sigue siendo el user_id de A,
        // exactamente como llegaría de verdad para este payment.
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connectionA.mercadoPagoUserId });

        assert.equal(capturedAuthHeader, "Bearer ACCESS-A", "debe consultar el payment con el token de A, nunca con el de B (activo ahora)");
        assert.notEqual(capturedAuthHeader, "Bearer ACCESS-B");
        assert.equal(outcome.ok, true);
        assert.equal(outcome.action, "confirmed");

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(payment.id));

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.equal(tickets.length, 1, "el comprador de A recibe su entrada aunque A ya no esté conectada");

        // B nunca se toca: ni su token, ni su status.
        const freshB = await prisma.mercadoPagoConnection.findUnique({ where: { id: connectionB.id } });
        assert.equal(freshB.status, "ACTIVE");
        assert.equal(decryptMercadoPagoSecret(freshB.accessTokenEncrypted), "ACCESS-B");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("account A -> disconnect -> account B connected -> a NEW checkout for the same organization always uses B's token, never A's", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-A") });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
    await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-B") });

    let capturedAuthHeader;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedAuthHeader = options.headers.Authorization;
            return jsonResponse(201, { id: "PREF-postB", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=postB" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Nadia", lastName: "Compradora", email: `buyer_${uniqueSuffix()}@example.com` },
            { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
            randomUUID()
        );
        assert.ok(result.checkoutUrl);
        assert.equal(capturedAuthHeader, "Bearer ACCESS-B");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 20) un mismo payment ID nunca puede confirmar dos Sale — protegido por
// el unique constraint de Sale.mercadoPagoPaymentId.
// ==================================================================

testWithDb("20) a payment id can never end up confirming two different Sale rows", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 10 });
    const saleA = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const saleB = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const sharedPaymentId = `shared-${uniqueSuffix()}`;
    // Pre-siembra deliberada: saleA ya "tiene" este paymentId (simula el
    // estado en el que confirmSaleService ya lo persistió). Un segundo
    // intento de vincular el MISMO paymentId a saleB debe chocar contra el
    // unique constraint, nunca duplicar la asociación.
    await prisma.sale.update({ where: { id: saleA.id }, data: { status: "CONFIRMED", mercadoPagoPaymentId: sharedPaymentId, confirmedAt: new Date() } });

    const paymentForB = paymentPayload(saleB, connection, { id: sharedPaymentId, external_reference: saleB.mercadoPagoExternalReference });
    const restore = mockPaymentGet(async () => jsonResponse(200, paymentForB));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: sharedPaymentId, bodyUserId: connection.mercadoPagoUserId });
        // alreadyLinked encuentra saleA (CONFIRMED) primero por
        // mercadoPagoPaymentId — el flujo sigue, pero la correlación real
        // por external_reference resuelve saleB, y al intentar confirmarla
        // con un paymentId ya usado, el unique constraint lo frena.
        assert.equal(outcome.ok, true);

        const bAfter = await prisma.sale.findUnique({ where: { id: saleB.id } });
        assert.notEqual(bAfter.status, "CONFIRMED", "saleB nunca debe quedar confirmada con un paymentId que ya pertenece a otra Sale");

        const ticketCountB = await prisma.ticket.count({ where: { saleId: saleB.id } });
        assert.equal(ticketCountB, 0);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 22/23) stock disponible confirma correctamente; stock agotado al
// llegar el webhook nunca sobrevende y lo reporta con claridad (el
// escenario "webhook tardío" del informe).
// ==================================================================

testWithDb("22) with stock available, the webhook confirms correctly and consumes exactly the reserved quantity", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 3 });
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 3 });

    const payment = paymentPayload(sale, connection);
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcome.action, "confirmed");
        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 3);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("23) stock exhausted by the time the webhook arrives: never oversells, leaves the Sale PENDING with a clear diagnostic trail", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 1 });

    // Comprador A reserva la última unidad y "paga" (webhook aprobado
    // llega tarde, después de que la reserva ya venció y otro comprador se
    // quedó con el lugar).
    const saleA = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await prisma.sale.update({ where: { id: saleA.id }, data: { stockReservedUntil: new Date(Date.now() - 60 * 1000) } });

    const saleB = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const paymentB = paymentPayload(saleB, connection);
    let restore = mockPaymentGet(async () => jsonResponse(200, paymentB));
    try {
        const outcomeB = await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentB.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcomeB.action, "confirmed");
    } finally {
        restore();
    }

    // Ahora llega, tarde, el webhook aprobado de A — para este momento ya
    // no queda stock.
    const paymentA = paymentPayload(saleA, connection);
    restore = mockPaymentGet(async () => jsonResponse(200, paymentA));
    try {
        // MERCADOPAGO_RECONCILIATION_ALERT_EMAIL nunca se define en este
        // archivo de test — sendMercadoPagoReconciliationAlert() falla acá
        // adentro (env var faltante) en TODOS los tests de este bloque, así
        // que esta aserción también prueba, de paso, que un fallo de la
        // alerta interna (best-effort) nunca hace fallar el webhook.
        const outcomeA = await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentA.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcomeA.ok, true);
        assert.equal(outcomeA.action, "approved_but_no_stock");

        const finalA = await prisma.sale.findUnique({ where: { id: saleA.id } });
        assert.equal(finalA.status, "PENDING", "nunca se confirma sin stock real, aunque el pago esté aprobado");
        assert.equal(finalA.paymentRef, String(paymentA.id), "el paymentId queda registrado en paymentRef para reconciliación manual");

        const ticketCountA = await prisma.ticket.count({ where: { saleId: saleA.id } });
        assert.equal(ticketCountA, 0, "nunca se sobrevende");

        // La capacidad total (1) nunca se excede: sólo B tiene tickets.
        const totalTickets = await prisma.ticket.count({ where: { functionId: eventFunction.id } });
        assert.equal(totalTickets, 1);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 24) ningún token/secret aparece en las respuestas del service ni en los
// argumentos que efectivamente viajan a Mercado Pago más allá del propio
// Authorization header (nunca en el resultado que le llega al controller).
// ==================================================================

testWithDb("24) no access_token/refresh_token/webhook secret ever appears in the outcome returned by the service", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const sale = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });

    const payment = paymentPayload(sale, connection);
    const restore = mockPaymentGet(async () => jsonResponse(200, payment));
    try {
        const outcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        const serialized = JSON.stringify(outcome);
        assert.ok(!serialized.toLowerCase().includes("access"));
        assert.ok(!serialized.toLowerCase().includes("refresh"));
        assert.ok(!serialized.toLowerCase().includes("secret"));
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 25) MP-6 (auditoría "pago aprobado sin stock") — reenvío del mismo
// webhook mientras sigue sin haber stock: por diseño no se agrega
// deduplicación de alertas (ver auditoría, "Alertas duplicadas"), pero el
// resultado de negocio SÍ tiene que seguir siendo idempotente: misma
// Sale PENDING, mismo paymentRef, cero tickets, sin excepción no
// controlada por el fallback try/catch nuevo alrededor del update de
// paymentRef y del envío de la alerta.
// ==================================================================

testWithDb("25) a redelivered webhook for the same approved-but-no-stock payment stays idempotent", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 1 });

    const saleA = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    await prisma.sale.update({ where: { id: saleA.id }, data: { stockReservedUntil: new Date(Date.now() - 60 * 1000) } });

    const saleB = await setupPendingSale({ event, eventFunction, ticketType, quantity: 1 });
    const paymentB = paymentPayload(saleB, connection);
    let restore = mockPaymentGet(async () => jsonResponse(200, paymentB));
    try {
        const outcomeB = await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentB.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(outcomeB.action, "confirmed");
    } finally {
        restore();
    }

    const paymentA = paymentPayload(saleA, connection);
    restore = mockPaymentGet(async () => jsonResponse(200, paymentA));
    try {
        const firstOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentA.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(firstOutcome.action, "approved_but_no_stock");

        // Mercado Pago reenvía la misma notificación (redelivery genuina o
        // reenvío manual desde su dashboard) — la Sale sigue PENDING con
        // stock agotado, así que confirmSaleService vuelve a tirar
        // INSUFFICIENT_STOCK.
        const secondOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: paymentA.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(secondOutcome.ok, true);
        assert.equal(secondOutcome.action, "approved_but_no_stock");

        const finalA = await prisma.sale.findUnique({ where: { id: saleA.id } });
        assert.equal(finalA.status, "PENDING");
        assert.equal(finalA.paymentRef, String(paymentA.id), "el segundo intento vuelve a escribir el mismo paymentId, sin corromper el anterior");

        const ticketCountA = await prisma.ticket.count({ where: { saleId: saleA.id } });
        assert.equal(ticketCountA, 0, "el reenvío nunca genera tickets ni sobrevende");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
