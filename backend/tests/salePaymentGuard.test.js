import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService, getSaleStatusService } from "../src/services/sale.service.js";
import { issueCourtesyService } from "../src/services/courtesy.service.js";
import { VERIFIED_SALE_OPTIONS, verifiedPaymentEvidenceFor } from "./helpers/verifiedPayment.js";

// Regla inviolable contra Postgres real (backend/.env.test): una venta paga
// nunca pasa a CONFIRMED ni genera Tickets sin evidencia de pago aprobado
// verificada server-side. Complementa salePaymentGuard.unit.test.js (sin
// DB). Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 6).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// Resend (email de confirmación de cortesía): siempre interceptado.
function mockResendFetch() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("api.resend.com/emails")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

async function setup() {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER" },
    });
    const organization = await prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id },
    });
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: organization.id, createdBy: owner.id, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 5000, quantity: 50, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    const buyer = await prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", clerkId: null } });
    return { owner, organization, event, eventFunction, ticketType, buyer };
}

async function cleanup({ owner, organization, event, buyer }) {
    const eventIds = [event.id];
    await prisma.courtesyIssuance.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, buyer.id] } } });
}

function saleInput(ctx, quantity = 1) {
    return {
        eventId: ctx.event.id,
        functionId: ctx.eventFunction.id,
        items: [{ ticketTypeId: ctx.ticketType.id, quantity }],
        buyerDocument: "30111222",
    };
}

testWithDb("venta paga PENDING (MANUAL o MERCADO_PAGO) sin evidencia: sigue PENDING, 0 tickets; token/estado no confirman", async () => {
    const ctx = await setup();
    try {
        for (const options of [{}, VERIFIED_SALE_OPTIONS]) {
            const sale = await createSaleForBuyer(ctx.buyer, saleInput(ctx), options);
            assert.ok(sale.publicRecoveryToken);
            await assert.rejects(confirmSaleService(ctx.owner.clerkId, sale.id), (e) => e.code === "SALE_PAYMENT_NOT_VERIFIED");
            await assert.rejects(
                confirmSaleService(ctx.owner.clerkId, sale.id, { paymentEvidence: { paymentId: sale.publicRecoveryToken, status: "approved" } }),
                (e) => e.code === "SALE_PAYMENT_NOT_VERIFIED"
            );
            const reloaded = await prisma.sale.findUnique({ where: { id: sale.id } });
            assert.equal(reloaded.status, "PENDING");
            assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 0);
            // Recovery/status por token: informa, nunca eleva a CONFIRMED.
            const status = await getSaleStatusService(sale.publicRecoveryToken);
            assert.equal(status.status, "PENDING");
            assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 0);
        }
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("venta Mercado Pago + evidencia verificada: confirma y genera tickets; reconfirmar es idempotente (sin duplicados)", async () => {
    const ctx = await setup();
    try {
        const sale = await createSaleForBuyer(ctx.buyer, saleInput(ctx, 2), VERIFIED_SALE_OPTIONS);
        const evidence = verifiedPaymentEvidenceFor(sale);
        const first = await confirmSaleService(ctx.owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: evidence });
        assert.equal(first.sale.status, "CONFIRMED");
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 2);

        const confirmed = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(confirmed.mercadoPagoPaymentId, evidence.paymentId);
        assert.equal(confirmed.confirmationSource, "WEBHOOK");

        await confirmSaleService(ctx.owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(confirmed) });
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 2, "un reintento no duplica tickets");

        // CONFIRMED histórica: una llamada sin evidencia no la toca.
        await assert.rejects(confirmSaleService(ctx.owner.clerkId, sale.id), (e) => e.code === "SALE_PAYMENT_NOT_VERIFIED");
        const after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(after.status, "CONFIRMED");
        assert.equal(after.confirmedAt.getTime(), confirmed.confirmedAt.getTime());
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 2);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("cortesía legítima (issueCourtesyService) sigue funcionando", async () => {
    const ctx = await setup();
    const restore = mockResendFetch();
    try {
        const result = await issueCourtesyService(ctx.owner.clerkId, {
            eventId: ctx.event.id,
            functionId: ctx.eventFunction.id,
            ticketTypeId: ctx.ticketType.id,
            quantity: 1,
            deliveryMethod: "SHARE",
            reason: "OTHER",
        });
        assert.ok(result);
        const courtesySales = await prisma.sale.findMany({ where: { eventId: ctx.event.id, origin: "COURTESY" } });
        assert.equal(courtesySales.length, 1);
        assert.equal(courtesySales[0].status, "CONFIRMED");
        assert.equal(await prisma.ticket.count({ where: { saleId: courtesySales[0].id } }), 1);
    } finally {
        restore();
        await cleanup(ctx);
    }
});
