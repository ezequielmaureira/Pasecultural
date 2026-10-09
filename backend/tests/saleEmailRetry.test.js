import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import { retryFailedSaleConfirmationEmailsService } from "../src/services/email/retryFailedSaleConfirmationEmails.service.js";
import { VERIFIED_SALE_OPTIONS, verifiedPaymentEvidenceFor } from "./helpers/verifiedPayment.js";

// Reintento automático de emails de confirmación — Postgres real, Resend
// simulado (nunca sale un email real: fetch reemplazado acá y bloqueado
// para cualquier otro host por testSafetyPreload.js).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 4).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function mockResend({ fail = false } = {}) {
    const original = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            sent.push({ to: body.to, idempotencyKey: opts.headers?.["Idempotency-Key"] ?? opts.headers?.get?.("Idempotency-Key") ?? null });
            if (fail) return { ok: false, status: 500, headers: { entries: () => [] }, json: async () => ({ name: "internal_server_error", message: "boom" }) };
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return { sent, restore: () => (globalThis.fetch = original) };
}

async function createConfirmedSale() {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({ data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Owner", role: "ORGANIZER" } });
    const org = await prisma.organization.create({ data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id } });
    const event = await prisma.event.create({ data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: org.id, createdBy: owner.id, status: "PUBLISHED", visibility: "PUBLIC" } });
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const eventFunction = await prisma.eventFunction.create({ data: { eventId: event.id, date, endAt: new Date(date.getTime() + 3600000), venue: "Teatro" } });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 1000, quantity: 10, maxPerPurchase: 5 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    const buyer = await prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Ana", lastName: "Paz" } });
    const pending = await createSaleForBuyer(
        buyer,
        { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 2 }], buyerDocument: "30111222" },
        VERIFIED_SALE_OPTIONS
    );
    await confirmSaleService(owner.clerkId, pending.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(pending) });
    return { sale: await prisma.sale.findUnique({ where: { id: pending.id } }), ids: { eventId: event.id, orgId: org.id, userIds: [owner.id, buyer.id] } };
}

async function cleanup({ eventId, orgId, userIds }) {
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId } } });
    await prisma.sale.deleteMany({ where: { eventId } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId } } });
    await prisma.ticketType.deleteMany({ where: { eventId } });
    await prisma.eventFunction.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

testWithDb("RETRY-A: un email FAILED vencido se reintenta una vez, queda SENT y no se vuelve a mandar", async () => {
    const { sale, ids } = await createConfirmedSale();
    await prisma.sale.update({
        where: { id: sale.id },
        data: { confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const resend = mockResend();
    try {
        await retryFailedSaleConfirmationEmailsService();
        let after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(after.confirmationEmailStatus, "SENT");
        const sentForSale = () => resend.sent.filter((s) => s.idempotencyKey === `sale-confirmed/${sale.id}`).length;
        assert.equal(sentForSale(), 1, "idempotencyKey fija por venta");

        // Segunda y tercera ronda: SENT nunca se vuelve a reclamar.
        await retryFailedSaleConfirmationEmailsService();
        await retryFailedSaleConfirmationEmailsService();
        after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(sentForSale(), 1, "nunca un duplicado");
        assert.equal(after.confirmationEmailAttempts, 2);
    } finally {
        resend.restore();
        await cleanup(ids);
    }
});

testWithDb("RETRY-B: dos rondas simultáneas (dos máquinas) mandan UN solo email", async () => {
    const { sale, ids } = await createConfirmedSale();
    await prisma.sale.update({
        where: { id: sale.id },
        data: { confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const resend = mockResend();
    try {
        await Promise.all([retryFailedSaleConfirmationEmailsService(), retryFailedSaleConfirmationEmailsService(), retryFailedSaleConfirmationEmailsService()]);
        assert.equal(resend.sent.filter((s) => s.idempotencyKey === `sale-confirmed/${sale.id}`).length, 1);
    } finally {
        resend.restore();
        await cleanup(ids);
    }
});

testWithDb("RETRY-C: si Resend sigue fallando, se respeta la espera y el tope de intentos", async () => {
    const { sale, ids } = await createConfirmedSale();
    await prisma.sale.update({
        where: { id: sale.id },
        data: { confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const resend = mockResend({ fail: true });
    try {
        await retryFailedSaleConfirmationEmailsService();
        let after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(after.confirmationEmailStatus, "FAILED");
        assert.equal(after.confirmationEmailAttempts, 2);
        // Recién reintentado: dentro de la espera, la ronda siguiente no lo toca.
        await retryFailedSaleConfirmationEmailsService();
        after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(after.confirmationEmailAttempts, 2);
        // Ya en el tope: nunca más, aunque haya pasado mucho tiempo.
        await prisma.sale.update({ where: { id: sale.id }, data: { confirmationEmailAttempts: 5, confirmationEmailLastAttemptAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
        const sentBefore = resend.sent.length;
        await retryFailedSaleConfirmationEmailsService();
        assert.equal(resend.sent.length, sentBefore);
    } finally {
        resend.restore();
        await cleanup(ids);
    }
});

testWithDb("RETRY-D: ventas no confirmadas nunca reciben email", async () => {
    const { sale, ids } = await createConfirmedSale();
    await prisma.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED", confirmationEmailStatus: "FAILED", confirmationEmailLastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const resend = mockResend();
    try {
        await retryFailedSaleConfirmationEmailsService();
        assert.equal(resend.sent.length, 0);
    } finally {
        resend.restore();
        await cleanup(ids);
    }
});

testWithDb("RETRY-E: una cortesía 'Compartir' (email PENDING a propósito) nunca recibe email del job", async () => {
    const { sale, ids } = await createConfirmedSale();
    await prisma.sale.update({
        where: { id: sale.id },
        data: { origin: "COURTESY", confirmationEmailStatus: "PENDING", confirmationEmailAttempts: 0, confirmedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const resend = mockResend();
    try {
        await retryFailedSaleConfirmationEmailsService();
        assert.equal(resend.sent.length, 0);
        assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).confirmationEmailStatus, "PENDING");
    } finally {
        resend.restore();
        await cleanup(ids);
    }
});
