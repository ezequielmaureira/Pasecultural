import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { processMercadoPagoWebhookNotification } from "../src/services/mercadoPagoWebhook.service.js";
import {
    requestPaymentRecoveryCodeService,
    resendPaymentRecoveryCodeService,
    verifyPaymentRecoveryCodeService,
} from "../src/services/mercadoPagoBuyerRecovery.service.js";
import { requestPaymentRecoveryCode, verifyPaymentRecoveryCode } from "../src/controllers/sale.controller.js";
import saleRoutes from "../src/routes/sale.routes.js";
import { encryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";

// Ronda "recuperación de pagos" (parte 2) — "Pagué pero no recibí mis
// entradas". CRUD + transacciones + concurrencia real, contra Postgres real
// (backend/.env.test). Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");
process.env.RESEND_API_KEY = "test-resend-key";
process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
process.env.FRONTEND_URL = "https://pasecultural.test";

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

async function createEventWithTicketType(organizationId, createdBy, { price = 10000, quantity = 100, maxPerPurchase = 10 } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price, quantity, maxPerPurchase } });
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

async function cleanupVerification(normalizedEmail, normalizedDocument) {
    await prisma.salePaymentRecoveryVerification.deleteMany({ where: { normalizedEmail, normalizedDocument } }).catch(() => {});
}

// Router de fetch combinado — Resend (captura el código de 6 dígitos
// realmente mandado, mismo patrón que organizationDeveloperAlert.crud.test.js)
// + Mercado Pago (GET /v1/payments/{id} puntual, este flujo nunca llama a
// los endpoints de búsqueda — el comprador YA aporta el paymentId exacto).
function mockCombinedFetch({ paymentsById = {} } = {}) {
    const original = globalThis.fetch;
    let capturedCode = null;
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            const match = String(body.text ?? "").match(/(\d{6})/);
            if (match) capturedCode = match[1];
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        if (u.includes("/checkout/preferences")) {
            return { ok: true, status: 201, json: async () => ({ id: `PREF-${uniqueSuffix()}`, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" }) };
        }
        if (u.includes("/v1/payments/")) {
            const id = decodeURIComponent(u.split("/v1/payments/")[1]);
            const payment = paymentsById[id];
            if (!payment) return { ok: false, status: 404, json: async () => ({ message: "not found" }) };
            return { ok: true, status: 200, json: async () => payment };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return {
        restore: () => {
            globalThis.fetch = original;
        },
        getCapturedCode: () => capturedCode,
    };
}

async function setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument, quantity = 1 }) {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            return { ok: true, status: 201, json: async () => ({ id: `PREF-${uniqueSuffix()}`, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" }) };
        }
        throw new Error(`unexpected fetch during setup: ${url}`);
    };
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Nadia", lastName: "Compradora", email },
            { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity }], buyerDocument },
            randomUUID()
        );
        return prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
    } finally {
        globalThis.fetch = original;
    }
}

// Backdatea stockReservedUntil directamente en la base — createSaleForBuyer
// siempre reserva 15 minutos desde "ahora", así que para simular una reserva
// vencida (el escenario real: la Sale que "llega tarde" ya no cuenta como
// indisponible) hay que retroceder el reloj a mano. Mismo helper que ya usa
// mercadoPagoReconciliation.service.test.js.
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

// Pide el código y lo verifica end-to-end, devolviendo el código capturado
// (para tests que necesitan reusarlo/mal-usarlo) y el resultado de verify.
async function requestAndCaptureCode({ email, buyerDocument }) {
    const mock = mockCombinedFetch({});
    try {
        await requestPaymentRecoveryCodeService({ email, buyerDocument });
        return mock.getCapturedCode();
    } finally {
        mock.restore();
    }
}

// ==================================================================
// 1) Ausencia de enumeración — misma respuesta exista o no una compra real
// detrás, para el paso 1 y para el reenvío.
// ==================================================================

testWithDb("1) requesting the OTP never reveals whether a matching purchase exists (no enumeration)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    const otherEmail = `nobody_${uniqueSuffix()}@example.com`;
    const mock = mockCombinedFetch({});
    try {
        const realResult = await requestPaymentRecoveryCodeService({ email, buyerDocument });
        const fakeResult = await requestPaymentRecoveryCodeService({ email: otherEmail, buyerDocument: "40222333" });

        assert.deepEqual(Object.keys(realResult), Object.keys(fakeResult));
        assert.equal(typeof realResult.maskedEmail, "string");
        assert.equal(typeof fakeResult.maskedEmail, "string");

        // Sólo el par real crea una sesión OTP de verdad (chequeo interno,
        // nunca expuesto en la respuesta pública de arriba).
        const realSession = await prisma.salePaymentRecoveryVerification.findUnique({
            where: { normalizedEmail_normalizedDocument: { normalizedEmail: email.toLowerCase(), normalizedDocument: buyerDocument } },
        });
        const fakeSession = await prisma.salePaymentRecoveryVerification.findUnique({
            where: { normalizedEmail_normalizedDocument: { normalizedEmail: otherEmail.toLowerCase(), normalizedDocument: "40222333" } },
        });
        assert.ok(realSession?.codeHash, "el par real sí genera un código");
        assert.equal(fakeSession, null, "el par inventado nunca crea una fila");
    } finally {
        mock.restore();
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 2/3/4/5) OTP incorrecto, vencido, consumido, demasiados intentos.
// ==================================================================

testWithDb("2) an incorrect OTP code is rejected without revealing anything about the underlying data", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    try {
        await requestAndCaptureCode({ email, buyerDocument });
        await assert.rejects(
            () => verifyPaymentRecoveryCodeService({ email, buyerDocument, code: "000000", paymentId: "123" }),
            (err) => err.code === "RECOVER_VERIFICATION_CODE_INVALID"
        );
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("3) an expired OTP code is rejected", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        await prisma.salePaymentRecoveryVerification.updateMany({
            where: { normalizedEmail: email.toLowerCase(), normalizedDocument: buyerDocument },
            data: { codeExpiresAt: new Date(Date.now() - 1000) },
        });
        await assert.rejects(
            () => verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: "123" }),
            (err) => err.code === "RECOVER_VERIFICATION_CODE_EXPIRED"
        );
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("4) a correct OTP code is single-use — reusing it after a successful verification fails", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    const payment = paymentPayload(sale, connection);
    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({ paymentsById: { [String(payment.id)]: payment } });
        let first;
        try {
            first = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(payment.id) });
        } finally {
            mock.restore();
        }
        assert.equal(first.matched, true);

        await assert.rejects(
            () => verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(payment.id) }),
            (err) => err.code === "RECOVER_VERIFICATION_CODE_INVALID"
        );
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("5) too many failed OTP attempts locks out further tries until a new code is requested", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    try {
        await requestAndCaptureCode({ email, buyerDocument });
        for (let i = 0; i < 5; i += 1) {
            await assert.rejects(() => verifyPaymentRecoveryCodeService({ email, buyerDocument, code: "000000", paymentId: "123" }));
        }
        await assert.rejects(
            () => verifyPaymentRecoveryCodeService({ email, buyerDocument, code: "000000", paymentId: "123" }),
            (err) => err.code === "RECOVER_VERIFICATION_TOO_MANY_ATTEMPTS"
        );
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 6) PENDING recuperada correctamente — caso principal.
// ==================================================================

testWithDb("6) a PENDING Sale with an approved matching payment is confirmed, tickets issued, confirmationSource=BUYER_RECOVERY", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });
    const payment = paymentPayload(sale, connection);

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({ paymentsById: { [String(payment.id)]: payment } });
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(payment.id) });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, true);
        assert.equal(result.recoveryToken, sale.publicRecoveryToken);

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.status, "CONFIRMED");
        assert.equal(confirmed.mercadoPagoPaymentId, String(payment.id));
        assert.equal(confirmed.confirmationSource, "BUYER_RECOVERY");

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 7/8) CONFIRMED con mismo paymentId (idempotente) vs paymentId distinto.
// ==================================================================

testWithDb("7) a CONFIRMED Sale with the SAME paymentId allows an idempotent resend, never a new Ticket", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });
    const payment = paymentPayload(sale, connection);

    // Confirma primero vía webhook real (camino normal) — después el
    // comprador usa "Pagué pero no recibí mis entradas" igual, ej. porque el
    // primer email nunca llegó.
    const webhookMock = mockCombinedFetch({ paymentsById: { [String(payment.id)]: payment } });
    try {
        const webhookOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(webhookOutcome.action, "confirmed");
    } finally {
        webhookMock.restore();
    }

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({});
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(payment.id) });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, true);
        assert.equal(result.recoveryToken, sale.publicRecoveryToken);

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "nunca se duplica el Ticket");
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("8) a CONFIRMED Sale with a DIFFERENT paymentId never allows a resend (matched: false)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });
    const payment = paymentPayload(sale, connection);

    const webhookMock = mockCombinedFetch({ paymentsById: { [String(payment.id)]: payment } });
    try {
        await processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId });
    } finally {
        webhookMock.restore();
    }

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({});
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: "999999999" });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, false);
        const untouched = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(untouched.mercadoPagoPaymentId, String(payment.id), "el paymentId original nunca cambia");
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 9) Varias Sales candidatas — el paymentId identifica exactamente una.
// ==================================================================

testWithDb("9) with multiple PENDING candidate Sales for the same buyer, the paymentId identifies exactly one", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";

    const { event: eventA, eventFunction: fnA, ticketType: ttA } = await createEventWithTicketType(org.id, owner.id);
    const { event: eventB, eventFunction: fnB, ticketType: ttB } = await createEventWithTicketType(org.id, owner.id);
    const saleA = await setupPendingSale({ event: eventA, eventFunction: fnA, ticketType: ttA, email, buyerDocument });
    const saleB = await setupPendingSale({ event: eventB, eventFunction: fnB, ticketType: ttB, email, buyerDocument });
    const paymentB = paymentPayload(saleB, connection);

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({ paymentsById: { [String(paymentB.id)]: paymentB } });
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(paymentB.id) });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, true);
        assert.equal(result.recoveryToken, saleB.publicRecoveryToken);

        const confirmedA = await prisma.sale.findUnique({ where: { id: saleA.id } });
        const confirmedB = await prisma.sale.findUnique({ where: { id: saleB.id } });
        assert.equal(confirmedA.status, "PENDING", "la otra compra del mismo comprador queda intacta");
        assert.equal(confirmedB.status, "CONFIRMED");
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [eventA.id, eventB.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 10) paymentId de otra persona — nunca confirma la venta ajena.
// ==================================================================

testWithDb("10) a paymentId belonging to a stranger's Sale at the same organization never gets confirmed (probing is a no-op)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 5 });

    // "Atacante" — tiene su propia compra PENDING legítima (necesaria para
    // que el paso 1 le mande un código a SU propio correo).
    const attackerEmail = `attacker_${uniqueSuffix()}@example.com`;
    const attackerDocument = "30111222";
    const attackerSale = await setupPendingSale({ event, eventFunction, ticketType, email: attackerEmail, buyerDocument: attackerDocument });

    // Compra real de un desconocido, en la MISMA organización.
    const strangerEmail = `stranger_${uniqueSuffix()}@example.com`;
    const strangerSale = await setupPendingSale({ event, eventFunction, ticketType, email: strangerEmail, buyerDocument: "40333444" });
    const strangerPayment = paymentPayload(strangerSale, connection);

    try {
        const code = await requestAndCaptureCode({ email: attackerEmail, buyerDocument: attackerDocument });
        // El atacante usa SUS propios datos + el paymentId ajeno (adivinado/filtrado).
        const mock = mockCombinedFetch({ paymentsById: { [String(strangerPayment.id)]: strangerPayment } });
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({
                email: attackerEmail,
                buyerDocument: attackerDocument,
                code,
                paymentId: String(strangerPayment.id),
            });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, false, "nunca se revela ni se confirma la compra de otra persona");

        const untouchedStranger = await prisma.sale.findUnique({ where: { id: strangerSale.id } });
        assert.equal(untouchedStranger.status, "PENDING");
        assert.equal(untouchedStranger.mercadoPagoPaymentId, null);
        const untouchedAttacker = await prisma.sale.findUnique({ where: { id: attackerSale.id } });
        assert.equal(untouchedAttacker.status, "PENDING");
    } finally {
        await cleanupVerification(attackerEmail.toLowerCase(), attackerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 11) Concurrencia con webhook — una única confirmación efectiva.
// ==================================================================

testWithDb("11) buyer recovery and a real webhook racing on the same payment produce exactly one confirmation", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    const sale = await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });
    const payment = paymentPayload(sale, connection);

    try {
        const code = await requestAndCaptureCode({ email, buyerDocument });
        const mock = mockCombinedFetch({ paymentsById: { [String(payment.id)]: payment } });
        try {
            const [verifyResult, webhookOutcome] = await Promise.all([
                verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId: String(payment.id) }),
                processMercadoPagoWebhookNotification({ type: "payment", dataId: payment.id, bodyUserId: connection.mercadoPagoUserId }),
            ]);
            assert.equal(verifyResult.matched, true);
            assert.ok(["confirmed", "already_confirmed"].includes(webhookOutcome.action));
        } finally {
            mock.restore();
        }

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "nunca se duplica el Ticket bajo concurrencia real");
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 12) Falta de stock — pending_review, nunca sobrevende.
// ==================================================================

testWithDb("12) an approved payment with no stock left returns pending_review, never issues a Ticket, never oversells", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const connection = await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 1, maxPerPurchase: 1 });

    // Orden real del escenario: Sale A (lateSale) reserva el último cupo
    // PRIMERO. El webhook nunca la confirma. Recién cuando su reserva VENCE
    // (nunca antes: mientras sigue vigente, sigue "pesando" como
    // indisponible y una segunda Sale ni siquiera podría crearse sobre el
    // mismo cupo — exactamente el bug de fixture ya encontrado acá) puede
    // otra Sale (winnerSale) tomar y confirmar ese lugar. Recién ahí el
    // comprador de Sale A intenta recuperarla.
    const lateEmail = `buyer_${uniqueSuffix()}@example.com`;
    const lateDocument = "30111222";
    const lateSale = await setupPendingSale({ event, eventFunction, ticketType, email: lateEmail, buyerDocument: lateDocument });
    const latePayment = paymentPayload(lateSale, connection);
    await expireReservation(lateSale.id);

    // Otra Sale se queda con el único lugar mientras tanto.
    const winnerEmail = `winner_${uniqueSuffix()}@example.com`;
    const winnerSale = await setupPendingSale({ event, eventFunction, ticketType, email: winnerEmail, buyerDocument: "40555666" });
    const winnerPayment = paymentPayload(winnerSale, connection);
    const winnerMock = mockCombinedFetch({ paymentsById: { [String(winnerPayment.id)]: winnerPayment } });
    try {
        const winnerOutcome = await processMercadoPagoWebhookNotification({ type: "payment", dataId: winnerPayment.id, bodyUserId: connection.mercadoPagoUserId });
        assert.equal(winnerOutcome.action, "confirmed");
    } finally {
        winnerMock.restore();
    }

    try {
        const code = await requestAndCaptureCode({ email: lateEmail, buyerDocument: lateDocument });
        const mock = mockCombinedFetch({ paymentsById: { [String(latePayment.id)]: latePayment } });
        let result;
        try {
            result = await verifyPaymentRecoveryCodeService({ email: lateEmail, buyerDocument: lateDocument, code, paymentId: String(latePayment.id) });
        } finally {
            mock.restore();
        }

        assert.equal(result.matched, "pending_review");

        const stillPending = await prisma.sale.findUnique({ where: { id: lateSale.id } });
        assert.equal(stillPending.status, "PENDING");
        assert.equal(stillPending.paymentRef, String(latePayment.id));
        const lateTicketCount = await prisma.ticket.count({ where: { saleId: lateSale.id } });
        assert.equal(lateTicketCount, 0, "nunca se sobrevende");

        const totalActiveTickets = await prisma.ticket.count({ where: { eventId: event.id, status: "ACTIVE" } });
        assert.equal(totalActiveTickets, 1);
    } finally {
        await cleanupVerification(lateEmail.toLowerCase(), lateDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 13) Controller y rutas públicas.
// ==================================================================

test("13) the public routes for payment recovery are wired to the correct controllers", () => {
    const paths = saleRoutes.stack
        .filter((layer) => layer.route)
        .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    assert.ok(paths.some((p) => p.path === "/recover/payment" && p.methods.includes("post")));
    assert.ok(paths.some((p) => p.path === "/recover/payment/resend" && p.methods.includes("post")));
    assert.ok(paths.some((p) => p.path === "/recover/payment/verify" && p.methods.includes("post")));
});

testWithDb("13b) the request controller returns exactly what the service returns (200, generic body)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    const mock = mockCombinedFetch({});
    try {
        let statusCode;
        let jsonBody;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                jsonBody = body;
            },
        };
        const next = (err) => {
            throw err;
        };
        await requestPaymentRecoveryCode({ body: { email, buyerDocument } }, res, next);

        assert.equal(statusCode, 200);
        assert.equal(typeof jsonBody.maskedEmail, "string");
    } finally {
        mock.restore();
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("13c) the verify controller propagates the real HTTP status for a wrong OTP (never forces 200)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `buyer_${uniqueSuffix()}@example.com`;
    const buyerDocument = "30111222";
    await setupPendingSale({ event, eventFunction, ticketType, email, buyerDocument });

    try {
        await requestAndCaptureCode({ email, buyerDocument });

        let statusCode;
        let jsonBody;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                jsonBody = body;
            },
        };
        let capturedError = null;
        const next = (err) => {
            capturedError = err;
        };
        await verifyPaymentRecoveryCode({ body: { email, buyerDocument, code: "000000", paymentId: "123" } }, res, next);

        assert.equal(capturedError?.code, "RECOVER_VERIFICATION_CODE_INVALID");
        assert.equal(capturedError?.httpStatus, 400);
        assert.equal(statusCode, undefined, "res.json nunca se llama en el camino de error — next(error) lo maneja");
        assert.equal(jsonBody, undefined);
    } finally {
        await cleanupVerification(email.toLowerCase(), buyerDocument);
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
