import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import {
    requestWithdrawalRequestOtpService,
    resendWithdrawalRequestOtpService,
    verifyWithdrawalRequestOtpService,
} from "../src/services/withdrawalRequestVerification.service.js";
import { createWithdrawalRequestService, listWithdrawalRequestsService, updateWithdrawalRequestStatusService } from "../src/services/withdrawalRequest.service.js";
import { getDeveloperAlertConfigOrDefaults, replaceDeveloperAlertConfigService } from "../src/services/developerAlertConfig.service.js";

// Botón de arrepentimiento — CRUD + OTP + concurrencia + aislamiento
// multi-organizador contra Postgres real (backend/.env.test), mismo
// criterio que el resto de los archivos *.crud.test.js/*.service.test.js
// de esta sesión. Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 7).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// Mock del cliente Resend real — mismo criterio EXACTO que mockMpFetch/
// jsonResponse en mercadoPagoCheckout.service.test.js (monkeypatchear
// globalThis.fetch, restaurar al terminar): el SDK de Resend usa fetch
// internamente para POST https://api.resend.com/emails (ver
// node_modules/resend/dist/index.cjs#Emails.create), así que interceptarlo
// acá es el mismo mecanismo que ya usa el resto de este proyecto para
// servicios HTTP externos, nunca uno nuevo. `headers.entries()` tiene que
// existir porque el SDK arma `Object.fromEntries(response.headers.entries())`
// incluso en el camino exitoso — un objeto vacío alcanza.
function mockResendFetchSuccessOnly() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            return {
                ok: true,
                status: 200,
                headers: { entries: () => [] },
                json: async () => ({ id: `resend-test-${uniqueSuffix()}` }),
            };
        }
        throw new Error(`unexpected fetch call to ${url} during a Resend-mocked test`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

// Sólo para el/los test(s) que necesitan que un envío de Resend se
// interprete como EXITOSO (ver mockResendFetchSuccessOnly) — el resto del
// archivo deja RESEND_API_KEY/EMAIL_FROM tal cual están en
// backend/.env.test (que en este entorno no completan un envío real), y
// eso ya está cubierto por el test dedicado "a Resend failure never
// prevents the request from being persisted". Guarda y restaura los
// valores originales, nunca los pisa para el resto de la suite.
function withMockedResendEnv() {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalEmailFrom = process.env.EMAIL_FROM;
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.RESEND_API_KEY = "test-mocked-resend-api-key";
    process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
    process.env.FRONTEND_URL = "https://pasecultural.test";
    return () => {
        if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = originalApiKey;
        if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = originalEmailFrom;
        if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = originalFrontendUrl;
    };
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
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, phone: "+54 9 351 412-3456", ...overrides },
    });
}

async function createEventWithTicketType(organizationId, createdBy, { price = 5000, quantity = 50 } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price, quantity, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

// Crea una Sale realmente CONFIRMED (via el mismo núcleo que usa el resto
// de la app, nunca un prisma.sale.create a mano) para un email+DNI
// puntuales — así los fixtures tienen exactamente la misma forma
// (publicRecoveryToken, tickets, buyerDocument) que una compra real.
async function createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId, email, buyerDocument, quantity = 1 }) {
    const buyerUser = await prisma.user.create({ data: { email, firstName: "Compradora", clerkId: null } });
    const sale = await createSaleForBuyer(buyerUser, {
        eventId: event.id,
        functionId: eventFunction.id,
        items: [{ ticketTypeId: ticketType.id, quantity }],
        buyerDocument,
    });
    await confirmSaleService(organizerClerkId, sale.id, { skipAutoEmail: true });
    return prisma.sale.findUnique({ where: { id: sale.id } });
}

// verificationEmails: limpieza puntual de WithdrawalRequestVerification por
// email exacto (nunca un sweep global de la tabla — otros tests podrían
// estar corriendo en paralelo dentro del mismo archivo... en la práctica
// node:test corre los test() de un mismo archivo en secuencia, pero
// escribirlo scoped es lo correcto de todas formas).
async function cleanupWithdrawal({ eventIds = [], organizationIds = [], userIds = [], verificationEmails = [] }) {
    await prisma.withdrawalRequest.deleteMany({ where: { eventId: { in: eventIds } } });
    if (verificationEmails.length > 0) {
        await prisma.withdrawalRequestVerification.deleteMany({ where: { normalizedEmail: { in: verificationEmails.map((e) => e.toLowerCase()) } } });
    }
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

const BUYER_DOCUMENT = "30111222";

testWithDb("requesting an OTP returns the same neutral shape whether or not a matching purchase exists", async () => {
    const email = `nomatch_${uniqueSuffix()}@example.com`;
    const withMatch = await requestWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });
    const noMatchEmail = `definitely-nobody-${uniqueSuffix()}@example.com`;
    const withoutMatch = await requestWithdrawalRequestOtpService({ email: noMatchEmail, buyerDocument: "99999999" });

    assert.equal(typeof withMatch.maskedEmail, "string");
    assert.equal(typeof withoutMatch.maskedEmail, "string");
    assert.ok(!("sales" in withMatch), "the OTP-request step must never reveal any purchase data");
    assert.ok(!("sales" in withoutMatch));
});

testWithDb("a correct OTP verifies and returns only the caller's own eligible sales, with no sale data revealed before that", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `otp_${uniqueSuffix()}@example.com`;

    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        await requestWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });
        const session = await prisma.withdrawalRequestVerification.findUnique({
            where: { normalizedEmail_normalizedDocument: { normalizedEmail: email.toLowerCase(), normalizedDocument: BUYER_DOCUMENT } },
        });
        assert.ok(session?.codeHash, "requesting an OTP must persist a hashed code, never plaintext anywhere retrievable as such");

        // El código en sí sólo existe en memoria del lado servidor en el
        // momento del envío — para el test, se reconstruye vía acceso
        // directo al mecanismo de hash no es posible (correcto: eso es lo
        // que se está probando). En su lugar, se fuerza un código conocido
        // reescribiendo el hash directamente, simulando "yo sé el código
        // real que me llegó por email".
        const { hashVerificationCode } = await import("../src/utils/verificationCode.js");
        const knownCode = "123456";
        await prisma.withdrawalRequestVerification.update({ where: { id: session.id }, data: { codeHash: hashVerificationCode(knownCode) } });

        const result = await verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: knownCode });
        assert.equal(result.sales.length, 1);
        assert.equal(result.sales[0].saleToken, sale.publicRecoveryToken);
        assert.equal(result.sales[0].existingRequestStatus, null);
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("an incorrect OTP is rejected and increments attempts; too many attempts locks out until a new code is requested", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `wrongotp_${uniqueSuffix()}@example.com`;

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await requestWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });

        // 5 intentos con código incorrecto (attempts pasa de 0 a 5) —
        // todos rechazados como "código incorrecto", el límite recién se
        // evalúa en la LLAMADA siguiente (ver withdrawalRequestVerification.service.js:
        // el chequeo `attempts >= MAX` corre al principio de cada llamada,
        // usando el valor de ANTES de este intento).
        for (let i = 0; i < 5; i++) {
            await assert.rejects(
                () => verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: "000000" }),
                (err) => {
                    assert.equal(err.code, "WITHDRAWAL_VERIFICATION_CODE_INVALID");
                    return true;
                }
            );
        }
        // El sexto intento (ya con attempts=5) debe rechazarse por
        // demasiados intentos, no por código incorrecto.
        await assert.rejects(
            () => verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: "000000" }),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_VERIFICATION_TOO_MANY_ATTEMPTS");
                return true;
            }
        );
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("an expired OTP is rejected, and a verified OTP cannot be reused (single use)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `expiry_${uniqueSuffix()}@example.com`;

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await requestWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });

        const { hashVerificationCode } = await import("../src/utils/verificationCode.js");
        const knownCode = "654321";
        await prisma.withdrawalRequestVerification.updateMany({
            where: { normalizedEmail: email.toLowerCase(), normalizedDocument: BUYER_DOCUMENT },
            data: { codeHash: hashVerificationCode(knownCode), codeExpiresAt: new Date(Date.now() - 1000) },
        });

        await assert.rejects(
            () => verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: knownCode }),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_VERIFICATION_CODE_EXPIRED");
                return true;
            }
        );

        // Ahora sin vencimiento — verificar una vez OK, la segunda vez con
        // el MISMO código debe fallar (ya se invalidó al usarse).
        await prisma.withdrawalRequestVerification.updateMany({
            where: { normalizedEmail: email.toLowerCase(), normalizedDocument: BUYER_DOCUMENT },
            data: { codeHash: hashVerificationCode(knownCode), codeExpiresAt: new Date(Date.now() + 60000), attempts: 0 },
        });
        const first = await verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: knownCode });
        assert.equal(first.sales.length, 1);

        await assert.rejects(
            () => verifyWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT, code: knownCode }),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_VERIFICATION_CODE_INVALID");
                return true;
            }
        );
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("a manipulated/unknown token never resolves to any Sale (IDOR check)", async () => {
    await assert.rejects(
        () => createWithdrawalRequestService(`totally-made-up-token-${uniqueSuffix()}`, { reason: "OTRO" }),
        (err) => {
            assert.equal(err.code, "WITHDRAWAL_REQUEST_SALE_NOT_FOUND");
            return true;
        }
    );
});

testWithDb("creating a request is idempotent: a second attempt for the same Sale returns the existing active request instead of a duplicate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `idempotent_${uniqueSuffix()}@example.com`;

    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        const first = await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" });
        assert.equal(first.alreadyExisted, false);

        const second = await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        assert.equal(second.alreadyExisted, true);

        const rows = await prisma.withdrawalRequest.count({ where: { saleId: sale.id } });
        assert.equal(rows, 1, "a second request for the same Sale must never create a duplicate row");
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("concurrent request creation for the same Sale is DB-safe: exactly one row ends up active, never two", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `concurrent_${uniqueSuffix()}@example.com`;

    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        const [a, b] = await Promise.all([
            createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" }),
            createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ERROR_COMPRA" }),
        ]);
        const alreadyExistedCount = [a, b].filter((r) => r.alreadyExisted).length;
        assert.equal(alreadyExistedCount, 1, "exactly one of the two concurrent attempts must see alreadyExisted=true");

        const rows = await prisma.withdrawalRequest.count({ where: { saleId: sale.id, status: { in: ["REQUESTED", "CONTACTED"] } } });
        assert.equal(rows, 1);
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("a Resend failure never prevents the request from being persisted", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `resendfail_${uniqueSuffix()}@example.com`;
    const originalKey = process.env.RESEND_API_KEY;

    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        delete process.env.RESEND_API_KEY; // fuerza que getResendClient() explote dentro del bloque best-effort
        const result = await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" });
        assert.equal(result.alreadyExisted, false);

        const row = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        assert.ok(row, "the WithdrawalRequest row must exist even though the organizer email could not be sent");
        assert.equal(row.status, "REQUESTED");
    } finally {
        if (originalKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = originalKey;
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("the Developer volume alert only claims its cooldown once the threshold is reached, never per individual request", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 20 });
    const originalConfig = await getDeveloperAlertConfigOrDefaults();
    const emails = [];

    try {
        // Umbral bajo para que el test sea rápido: 2 solicitudes en 24h.
        await replaceDeveloperAlertConfigService(owner.id, { ...originalConfig, withdrawalRequestsWindowCount: 2, withdrawalRequestsWindowHours: 24 });

        const makeSale = async () => {
            const email = `volume_${uniqueSuffix()}@example.com`;
            emails.push(email);
            return createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        };

        const saleA = await makeSale();
        await createWithdrawalRequestService(saleA.publicRecoveryToken, { reason: "OTRO" });
        let cooldownRow = await prisma.developerAlertCooldown.findUnique({ where: { key: `WITHDRAWAL_REQUESTS_VOLUME_SPIKE:${org.id}` } });
        assert.equal(cooldownRow, null, "below the threshold, no Developer alert cooldown should be claimed yet");

        const saleB = await makeSale();
        await createWithdrawalRequestService(saleB.publicRecoveryToken, { reason: "OTRO" });
        cooldownRow = await prisma.developerAlertCooldown.findUnique({ where: { key: `WITHDRAWAL_REQUESTS_VOLUME_SPIKE:${org.id}` } });
        assert.ok(cooldownRow, "once the threshold is reached, the volume alert must claim its cooldown");
    } finally {
        await replaceDeveloperAlertConfigService(owner.id, originalConfig);
        await prisma.developerAlertCooldown.deleteMany({ where: { key: `WITHDRAWAL_REQUESTS_VOLUME_SPIKE:${org.id}` } });
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: emails });
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
});

testWithDb("multi-organizer isolation: an ORGANIZER never sees or can update another organization's withdrawal requests", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const fixtureA = await createEventWithTicketType(orgA.id, ownerA.id);

    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    const fixtureB = await createEventWithTicketType(orgB.id, ownerB.id);

    const emailA = `isoA_${uniqueSuffix()}@example.com`;
    const emailB = `isoB_${uniqueSuffix()}@example.com`;

    try {
        const saleA = await createConfirmedSale({ event: fixtureA.event, eventFunction: fixtureA.eventFunction, ticketType: fixtureA.ticketType, organizerClerkId: ownerA.clerkId, email: emailA, buyerDocument: BUYER_DOCUMENT });
        const saleB = await createConfirmedSale({ event: fixtureB.event, eventFunction: fixtureB.eventFunction, ticketType: fixtureB.ticketType, organizerClerkId: ownerB.clerkId, email: emailB, buyerDocument: BUYER_DOCUMENT });

        await createWithdrawalRequestService(saleA.publicRecoveryToken, { reason: "OTRO" });
        const requestB = (await createWithdrawalRequestService(saleB.publicRecoveryToken, { reason: "OTRO" }));
        const requestBRow = await prisma.withdrawalRequest.findFirst({ where: { saleId: saleB.id } });

        // A nunca ve las solicitudes de B.
        const listForA = await listWithdrawalRequestsService(ownerA.clerkId);
        assert.ok(!listForA.some((r) => r.saleId === saleB.id), "ORGANIZER A must never see ORGANIZER B's withdrawal requests");

        // A tampoco puede actualizar el estado de la solicitud de B
        // manipulando el id directamente.
        await assert.rejects(
            () => updateWithdrawalRequestStatusService(ownerA.clerkId, requestBRow.id, "RESOLVED"),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_REQUEST_SALE_NOT_FOUND");
                return true;
            }
        );
        const stillUntouched = await prisma.withdrawalRequest.findUnique({ where: { id: requestBRow.id } });
        assert.equal(stillUntouched.status, "REQUESTED", "ORGANIZER A's rejected attempt must never have changed ORGANIZER B's request");

        void requestB;
    } finally {
        await cleanupWithdrawal({
            eventIds: [fixtureA.event.id, fixtureB.event.id],
            organizationIds: [orgA.id, orgB.id],
            userIds: [ownerA.id, ownerB.id],
            verificationEmails: [emailA, emailB],
        });
        await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    }
});

testWithDb("never modifies Sale.status, never marks any Ticket REFUNDED, regardless of the request's outcome", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `neverrefund_${uniqueSuffix()}@example.com`;

    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" });

        const saleAfter = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(saleAfter.status, "CONFIRMED", "registering a withdrawal request must never change Sale.status");

        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        assert.ok(tickets.length > 0);
        assert.ok(tickets.every((t) => t.status === "ACTIVE"), "registering a withdrawal request must never mark any Ticket as REFUNDED");
    } finally {
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

// Deliberadamente el ÚLTIMO test del archivo: getResendClient() (config/resend.js)
// cachea el cliente Resend a nivel de módulo (`if (cachedClient) return
// cachedClient`, nunca revalida RESEND_API_KEY después de la primera
// construcción exitosa) — un detalle correcto para producción (las env
// vars no cambian en runtime) pero que, en un archivo de tests que corren
// en el MISMO proceso, haría que el cliente mockeado acá (con un
// RESEND_API_KEY falso) quedara cacheado y se filtrara a cualquier test
// posterior que dependa de que Resend falle (ver "a Resend failure never
// prevents..." y todos los que crean un WithdrawalRequest después de
// éste). Correrlo último evita el problema por completo sin tocar
// config/resend.js — no hay evidencia de que su caching sea un bug real
// para producción, así que no se modifica código productivo por esto.
testWithDb("resending the OTP respects the same cooldown as the initial request, and refreshes the code — no email bombing", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `resendcooldown_${uniqueSuffix()}@example.com`;

    // Este entorno de TEST no tiene un RESEND_API_KEY real que complete un
    // envío (ver el resto de los tests de este archivo, que a propósito
    // NUNCA dependen de que el envío tenga éxito). Este test sí necesita
    // ejercitar el camino feliz completo del cooldown — para eso, y sólo
    // acá, se mockea la capa HTTP de Resend (mismo mecanismo que
    // mockMpFetch en mercadoPagoCheckout.service.test.js) en vez de
    // depender de un envío real o de debilitar la aserción.
    const restoreEnv = withMockedResendEnv();
    const restoreFetch = mockResendFetchSuccessOnly();

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        // 1) Primer request OTP exitoso — con Resend mockeado como
        // exitoso, el claim atómico debe persistir un lastSentAt real (no
        // null, que era exactamente la causa del fallo original).
        await requestWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });
        const afterFirst = await prisma.withdrawalRequestVerification.findUnique({
            where: { normalizedEmail_normalizedDocument: { normalizedEmail: email.toLowerCase(), normalizedDocument: BUYER_DOCUMENT } },
        });
        assert.ok(afterFirst?.codeHash, "a successful OTP request must persist a hashed code");
        assert.ok(afterFirst?.lastSentAt, "a successful OTP request must persist a real lastSentAt — the happy path this test exists to verify");

        // 2) Un segundo request INMEDIATO (dentro del cooldown de 1
        // minuto) respeta el cooldown: ni lastSentAt ni el código vigente
        // deben pisarse.
        await resendWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });
        const afterResendWithinCooldown = await prisma.withdrawalRequestVerification.findUnique({ where: { id: afterFirst.id } });
        assert.equal(afterResendWithinCooldown.lastSentAt.getTime(), afterFirst.lastSentAt.getTime(), "a resend within the cooldown window must not refresh lastSentAt");
        assert.equal(afterResendWithinCooldown.codeHash, afterFirst.codeHash, "a resend within the cooldown window must not invalidate the currently valid OTP");

        // 3) Una vez vencido el cooldown, el resend sí puede reclamarse de
        // nuevo — código y lastSentAt se refrescan.
        await prisma.withdrawalRequestVerification.update({ where: { id: afterFirst.id }, data: { lastSentAt: new Date(Date.now() - 61 * 1000) } });
        await resendWithdrawalRequestOtpService({ email, buyerDocument: BUYER_DOCUMENT });
        const afterResendPastCooldown = await prisma.withdrawalRequestVerification.findUnique({ where: { id: afterFirst.id } });
        assert.notEqual(afterResendPastCooldown.codeHash, afterFirst.codeHash, "once the cooldown passes, a resend must issue a fresh code");
        assert.ok(afterResendPastCooldown.lastSentAt.getTime() > afterFirst.lastSentAt.getTime(), "once the cooldown passes, a resend must refresh lastSentAt");
    } finally {
        restoreFetch();
        restoreEnv();
        await cleanupWithdrawal({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id], verificationEmails: [email] });
        await prisma.user.deleteMany({ where: { email } });
    }
});
