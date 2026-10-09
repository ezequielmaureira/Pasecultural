import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import { requestScannerLoginCodeService, verifyScannerLoginCodeService } from "../src/services/scannerLogin.service.js";
import { requireScannerSession } from "../src/middlewares/requireScannerSession.js";
import { scanTicketService, confirmScanService } from "../src/services/scanner.service.js";
import { disableScannerService } from "../src/services/eventScanner.service.js";
import { decryptSecret } from "../src/config/qrEncryption.js";
import { hashVerificationCode } from "../src/utils/verificationCode.js";
import { VERIFIED_SALE_OPTIONS, verifiedPaymentEvidenceFor } from "./helpers/verifiedPayment.js";

// Scanners de punta a punta — login por código de 6 dígitos, JWT de sesión,
// revocación inmediata, permisos por evento y escaneo (reuso, otro evento,
// cancelados, simultáneos). Postgres real; Resend simulado.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 3).toString("base64");
process.env.SCANNER_SESSION_SECRET = process.env.SCANNER_SESSION_SECRET || "scanner-test-secret";

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function mockResend() {
    const original = globalThis.fetch;
    const codes = [];
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            const match = String(body.text ?? body.html ?? "").match(/\b(\d{6})\b/);
            codes.push(match ? match[1] : null);
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    return { codes, restore: () => (globalThis.fetch = original) };
}

async function createEventCtx(owner, org, { functionOverrides = {}, eventOverrides = {} } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: org.id, createdBy: owner.id, status: "PUBLISHED", visibility: "PUBLIC", ...eventOverrides },
    });
    // Función en curso (empezó hace 1 h, termina en 2 h): se puede escanear.
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 2 * 3600000), venue: "Teatro", ...functionOverrides },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 1000, quantity: 50, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

async function setup() {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({ data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Owner", role: "ORGANIZER" } });
    const org = await prisma.organization.create({ data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id } });
    const a = await createEventCtx(owner, org);
    const b = await createEventCtx(owner, org);
    const scannerEmail = `scanner_${suffix}@example.com`;
    const scanner = await prisma.eventScanner.create({
        data: { eventId: a.event.id, name: "Puerta 1", gate: "Puerta 1", status: "ACTIVE", invitationToken: `inv-${suffix}`, email: scannerEmail, firstName: "Sole", lastName: "Scanner", createdBy: owner.id, activatedAt: new Date() },
    });
    const buyer = await prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Ana", lastName: "Paz" } });
    return { owner, org, a, b, scanner, scannerEmail, buyer };
}

// Compra real confirmada con evidencia verificada — devuelve los tokens QR.
async function buyTickets(ctx, eventCtx, quantity = 1) {
    const pending = await createSaleForBuyer(
        ctx.buyer,
        { eventId: eventCtx.event.id, functionId: eventCtx.eventFunction.id, items: [{ ticketTypeId: eventCtx.ticketType.id, quantity }], buyerDocument: "30111222" },
        VERIFIED_SALE_OPTIONS
    );
    await confirmSaleService(ctx.owner.clerkId, pending.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(pending) });
    const tickets = await prisma.ticket.findMany({ where: { saleId: pending.id }, include: { qr: true } });
    return tickets.map((t) => ({ id: t.id, token: `${t.id}.${decryptSecret(t.qr.secretEncrypted)}` }));
}

function scannerContextOf(row) {
    return { id: row.id, eventId: row.eventId, email: row.email, name: row.name, gate: row.gate, firstName: row.firstName, lastName: row.lastName, status: row.status };
}

async function runMiddleware(token) {
    const req = { get: (h) => (h.toLowerCase() === "authorization" && token ? `Bearer ${token}` : undefined) };
    return new Promise((resolve) => requireScannerSession(req, {}, (err) => resolve({ err, scanner: req.scanner })));
}

async function cleanup(ctx) {
    const eventIds = [ctx.a.event.id, ctx.b.event.id];
    await prisma.scanAttempt.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.checkIn.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventScanner.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: ctx.org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [ctx.owner.id, ctx.buyer.id] } } });
}

async function expectCode(promise, code) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.code, code);
        return true;
    });
}

// ------------------------------------------------------------------
// Login con código de 6 dígitos + JWT
// ------------------------------------------------------------------

testWithDb("SC-A: login con código de 6 dígitos => token de sesión válido; el código es de un solo uso", async () => {
    const ctx = await setup();
    const resend = mockResend();
    try {
        await requestScannerLoginCodeService({ email: ctx.scannerEmail.toUpperCase() });
        const code = resend.codes.at(-1);
        assert.match(code, /^\d{6}$/);

        const { scannerSessionToken } = await verifyScannerLoginCodeService({ email: ctx.scannerEmail, code });
        const { err, scanner } = await runMiddleware(scannerSessionToken);
        assert.equal(err, undefined);
        assert.equal(scanner.id, ctx.scanner.id);

        await expectCode(verifyScannerLoginCodeService({ email: ctx.scannerEmail, code }), "SCANNER_VERIFICATION_CODE_INVALID");
    } finally {
        resend.restore();
        await cleanup(ctx);
    }
});

testWithDb("SC-B: 5 códigos incorrectos bloquean; el correcto ya no sirve después", async () => {
    const ctx = await setup();
    const resend = mockResend();
    try {
        await requestScannerLoginCodeService({ email: ctx.scannerEmail });
        const code = resend.codes.at(-1);
        const wrong = code === "000000" ? "111111" : "000000";
        for (let i = 0; i < 5; i++) {
            await expectCode(verifyScannerLoginCodeService({ email: ctx.scannerEmail, code: wrong }), "SCANNER_VERIFICATION_CODE_INVALID");
        }
        await expectCode(verifyScannerLoginCodeService({ email: ctx.scannerEmail, code }), "SCANNER_VERIFICATION_TOO_MANY_ATTEMPTS");
    } finally {
        resend.restore();
        await cleanup(ctx);
    }
});

testWithDb("SC-C: ráfaga de 30 intentos en paralelo => nunca más de 5 comparaciones contra el código", async () => {
    const ctx = await setup();
    try {
        // Código conocido sembrado directo (sin email): ninguno de los 30 lo acierta.
        await prisma.eventScanner.update({
            where: { id: ctx.scanner.id },
            data: { verificationCodeHash: hashVerificationCode("424242"), verificationCodeExpiresAt: new Date(Date.now() + 600000), verificationAttempts: 0 },
        });
        const guesses = Array.from({ length: 30 }, (_, i) => String(100000 + i));
        const results = await Promise.allSettled(guesses.map((code) => verifyScannerLoginCodeService({ email: ctx.scannerEmail, code })));
        const invalid = results.filter((r) => r.status === "rejected" && r.reason.code === "SCANNER_VERIFICATION_CODE_INVALID").length;
        const blocked = results.filter((r) => r.status === "rejected" && r.reason.code === "SCANNER_VERIFICATION_TOO_MANY_ATTEMPTS").length;
        assert.ok(invalid <= 5, `como máximo 5 comparaciones reales, hubo ${invalid}`);
        assert.equal(invalid + blocked, 30);
        const row = await prisma.eventScanner.findUnique({ where: { id: ctx.scanner.id } });
        assert.equal(row.verificationAttempts, 5);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-D: JWT vencido, mal firmado o de otro tipo => sesión inválida", async () => {
    const ctx = await setup();
    try {
        const secret = process.env.SCANNER_SESSION_SECRET.trim();
        const expired = jwt.sign({ sub: ctx.scanner.id, typ: "scanner_session" }, secret, { expiresIn: -10 });
        const forged = jwt.sign({ sub: ctx.scanner.id, typ: "scanner_session" }, "otra-clave", { expiresIn: 3600 });
        const wrongType = jwt.sign({ sub: ctx.scanner.id, typ: "otro" }, secret, { expiresIn: 3600 });
        for (const token of [expired, forged, wrongType, "basura", null]) {
            const { err } = await runMiddleware(token);
            assert.equal(err?.code, "SCANNER_SESSION_INVALID");
        }
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-E: revocar un scanner corta su sesión de inmediato (sin esperar a que venza el JWT)", async () => {
    const ctx = await setup();
    const resend = mockResend();
    try {
        await requestScannerLoginCodeService({ email: ctx.scannerEmail });
        const { scannerSessionToken } = await verifyScannerLoginCodeService({ email: ctx.scannerEmail, code: resend.codes.at(-1) });
        assert.equal((await runMiddleware(scannerSessionToken)).err, undefined);

        await disableScannerService(ctx.owner.clerkId, ctx.a.event.id, ctx.scanner.id);
        assert.equal((await runMiddleware(scannerSessionToken)).err?.code, "SCANNER_SESSION_INVALID");
    } finally {
        resend.restore();
        await cleanup(ctx);
    }
});

// ------------------------------------------------------------------
// Escaneo
// ------------------------------------------------------------------

testWithDb("SC-F: entrada válida => READY, confirmación VALID, segundo escaneo ALREADY_USED", async () => {
    const ctx = await setup();
    try {
        const [ticket] = await buyTickets(ctx, ctx.a, 1);
        const context = scannerContextOf(ctx.scanner);
        const input = { eventId: ctx.a.event.id, functionId: ctx.a.eventFunction.id, token: ticket.token };
        assert.equal((await scanTicketService(context, input)).status, "READY");
        assert.equal((await confirmScanService(context, input)).status, "VALID");
        assert.equal((await confirmScanService(context, input)).status, "ALREADY_USED");
        assert.equal(await prisma.checkIn.count({ where: { ticketId: ticket.id } }), 1);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-G: 10 confirmaciones simultáneas del mismo QR => exactamente un ingreso", async () => {
    const ctx = await setup();
    try {
        const [ticket] = await buyTickets(ctx, ctx.a, 1);
        const context = scannerContextOf(ctx.scanner);
        const input = { eventId: ctx.a.event.id, functionId: ctx.a.eventFunction.id, token: ticket.token };
        const results = await Promise.all(Array.from({ length: 10 }, () => confirmScanService(context, input)));
        assert.equal(results.filter((r) => r.status === "VALID").length, 1);
        assert.equal(results.filter((r) => r.status === "ALREADY_USED").length, 9);
        assert.equal(await prisma.checkIn.count({ where: { ticketId: ticket.id } }), 1);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-H: QR de otro evento => WRONG_EVENT; QR adulterado => NOT_FOUND; ninguno genera ingreso", async () => {
    const ctx = await setup();
    try {
        const [ticketB] = await buyTickets(ctx, ctx.b, 1);
        const [ticketA] = await buyTickets(ctx, ctx.a, 1);
        const context = scannerContextOf(ctx.scanner);
        assert.equal((await confirmScanService(context, { eventId: ctx.a.event.id, token: ticketB.token })).status, "WRONG_EVENT");
        const tampered = `${ticketA.id}.${"x".repeat(32)}`;
        assert.equal((await confirmScanService(context, { eventId: ctx.a.event.id, token: tampered })).status, "NOT_FOUND");
        assert.equal(await prisma.checkIn.count({ where: { ticketId: { in: [ticketA.id, ticketB.id] } } }), 0);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-I: un scanner de un evento no puede operar otro evento al que no fue invitado", async () => {
    const ctx = await setup();
    try {
        const [ticketB] = await buyTickets(ctx, ctx.b, 1);
        await expectCode(scanTicketService(scannerContextOf(ctx.scanner), { eventId: ctx.b.event.id, token: ticketB.token }), "SCANNER_NOT_AUTHORIZED");
        await expectCode(confirmScanService(scannerContextOf(ctx.scanner), { eventId: ctx.b.event.id, token: ticketB.token }), "SCANNER_NOT_AUTHORIZED");
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-J: entrada de una función o un evento CANCELADOS nunca da ingreso (CANCELLED)", async () => {
    const ctx = await setup();
    try {
        const [t1, t2] = await buyTickets(ctx, ctx.a, 2);
        const context = scannerContextOf(ctx.scanner);
        await prisma.eventFunction.update({ where: { id: ctx.a.eventFunction.id }, data: { status: "CANCELLED" } });
        assert.equal((await confirmScanService(context, { eventId: ctx.a.event.id, token: t1.token })).status, "CANCELLED");
        await prisma.eventFunction.update({ where: { id: ctx.a.eventFunction.id }, data: { status: "SCHEDULED" } });
        await prisma.event.update({ where: { id: ctx.a.event.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
        assert.equal((await confirmScanService(context, { eventId: ctx.a.event.id, token: t2.token })).status, "CANCELLED");
        assert.equal(await prisma.checkIn.count({ where: { ticketId: { in: [t1.id, t2.id] } } }), 0);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("SC-K: entrada REFUNDED => CANCELLED, nunca ingreso", async () => {
    const ctx = await setup();
    try {
        const [ticket] = await buyTickets(ctx, ctx.a, 1);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "REFUNDED" } });
        assert.equal((await confirmScanService(scannerContextOf(ctx.scanner), { eventId: ctx.a.event.id, token: ticket.token })).status, "CANCELLED");
    } finally {
        await cleanup(ctx);
    }
});
