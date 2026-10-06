import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import {
    cancelTicketService,
    rehabilitateTicketService,
    reactivateUsedTicketService,
    markTicketUsedManuallyService,
    bulkApplyTicketActionService,
} from "../src/services/ticketAdmin.service.js";
import { VERIFIED_SALE_OPTIONS, verifiedPaymentEvidenceFor } from "./helpers/verifiedPayment.js";

// Contra Postgres real (backend/.env.test): una entrada cuyo dinero fue
// devuelto nunca vuelve a quedar utilizable por una acción del organizador.
// Complementa ticketRefundGuard.unit.test.js (sin DB). Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 6).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
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

async function confirmedSaleWithTickets(ctx, quantity) {
    const sale = await createSaleForBuyer(
        ctx.buyer,
        { eventId: ctx.event.id, functionId: ctx.eventFunction.id, items: [{ ticketTypeId: ctx.ticketType.id, quantity }], buyerDocument: "30111222" },
        VERIFIED_SALE_OPTIONS
    );
    await confirmSaleService(ctx.owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(sale) });
    const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id }, orderBy: { sequence: "asc" } });
    return { sale, tickets };
}

async function cleanup(ctx, saleIds = []) {
    const eventIds = [ctx.event.id];
    await prisma.developerAlertReversalEvent.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.checkIn.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticketAuditLog.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: { in: [ctx.owner.id, ctx.buyer.id] } } });
}

testWithDb("cancelación manual se rehabilita; tras una reversión de pago, CANCELLED/USED/REFUNDED no vuelven a ACTIVE", async () => {
    const ctx = await setup();
    const saleIds = [];
    try {
        const manual = await confirmedSaleWithTickets(ctx, 1);
        saleIds.push(manual.sale.id);
        await cancelTicketService(ctx.owner.clerkId, ctx.event.id, manual.tickets[0].id);
        await rehabilitateTicketService(ctx.owner.clerkId, ctx.event.id, manual.tickets[0].id);
        assert.equal((await prisma.ticket.findUnique({ where: { id: manual.tickets[0].id } })).status, "ACTIVE");

        const reversed = await confirmedSaleWithTickets(ctx, 3);
        saleIds.push(reversed.sale.id);
        const [toCancel, toUse, toRefund] = reversed.tickets;
        await cancelTicketService(ctx.owner.clerkId, ctx.event.id, toCancel.id);
        await markTicketUsedManuallyService(ctx.owner.clerkId, ctx.event.id, toUse.id);
        // Estado que deja mercadoPagoPaymentConfirmation.service.js ante un
        // refund/chargeback: ACTIVE -> REFUNDED + marca de reversión.
        await prisma.ticket.updateMany({ where: { saleId: reversed.sale.id, status: "ACTIVE" }, data: { status: "REFUNDED" } });
        await prisma.developerAlertReversalEvent.create({
            data: { organizationId: ctx.organization.id, saleId: reversed.sale.id, type: "CHARGED_BACK" },
        });

        await assert.rejects(rehabilitateTicketService(ctx.owner.clerkId, ctx.event.id, toCancel.id), (e) => e.code === "TICKET_REFUNDED_CANNOT_REACTIVATE");
        await assert.rejects(reactivateUsedTicketService(ctx.owner.clerkId, ctx.event.id, toUse.id), (e) => e.code === "TICKET_REFUNDED_CANNOT_REACTIVATE");
        await assert.rejects(rehabilitateTicketService(ctx.owner.clerkId, ctx.event.id, toRefund.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
        const bulk = await bulkApplyTicketActionService(ctx.owner.clerkId, ctx.event.id, {
            ticketIds: reversed.tickets.map((t) => t.id),
            action: "rehabilitate",
        });
        assert.deepEqual(bulk, []);

        const after = await prisma.ticket.findMany({ where: { saleId: reversed.sale.id }, orderBy: { sequence: "asc" } });
        assert.deepEqual(after.map((t) => t.status), ["CANCELLED", "USED", "REFUNDED"]);
    } finally {
        await cleanup(ctx, saleIds);
    }
});

testWithDb("devolución por arrepentimiento (auditoría con fuente de devolución) no se rehabilita", async () => {
    const ctx = await setup();
    const saleIds = [];
    try {
        const { sale, tickets } = await confirmedSaleWithTickets(ctx, 1);
        saleIds.push(sale.id);
        await prisma.$transaction([
            prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: "CANCELLED" } }),
            prisma.ticketAuditLog.create({
                data: {
                    ticketId: tickets[0].id,
                    action: "CANCEL",
                    fromStatus: "ACTIVE",
                    toStatus: "CANCELLED",
                    actorType: "ORGANIZER",
                    actorId: ctx.owner.id,
                    metadata: { source: "WITHDRAWAL_REQUEST_RETURN", withdrawalRequestId: "test" },
                },
            }),
        ]);
        await assert.rejects(rehabilitateTicketService(ctx.owner.clerkId, ctx.event.id, tickets[0].id), (e) => e.code === "TICKET_REFUNDED_CANNOT_REACTIVATE");
        assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[0].id } })).status, "CANCELLED");
    } finally {
        await cleanup(ctx, saleIds);
    }
});
