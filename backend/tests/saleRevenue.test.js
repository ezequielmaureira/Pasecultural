import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getRevenueBreakdownBySaleId, getNetRevenueByEventId } from "../src/services/saleRevenue.service.js";
import { listSalesOrganizerService } from "../src/services/sale.service.js";

// Recaudación del organizador (saleRevenue.service.js) — Postgres real.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function setup() {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({ data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Owner", role: "ORGANIZER" } });
    const org = await prisma.organization.create({ data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id } });
    const event = await prisma.event.create({ data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: org.id, createdBy: owner.id, status: "PUBLISHED" } });
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const eventFunction = await prisma.eventFunction.create({ data: { eventId: event.id, date, endAt: new Date(date.getTime() + 3600000), venue: "Teatro" } });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 1000, quantity: 100 } });
    const buyer = await prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Ana" } });
    return { owner, org, event, eventFunction, ticketType, buyer };
}

// Venta con N tickets de $1000 + cargo $150 por entrada (o sin desglose si legacy).
async function createSale(ctx, { status = "CONFIRMED", quantity = 2, legacy = false, ticketStatuses = [], origin = "SALE" } = {}) {
    const ticketsSubtotal = 1000 * quantity;
    const serviceFee = legacy ? null : 150 * quantity;
    const sale = await prisma.sale.create({
        data: {
            status,
            origin,
            paymentMethod: "MERCADO_PAGO",
            total: ticketsSubtotal + (serviceFee ?? 0),
            ticketsSubtotal: legacy ? null : ticketsSubtotal,
            serviceFee,
            buyerId: ctx.buyer.id,
            eventId: ctx.event.id,
            functionId: ctx.eventFunction.id,
            items: { create: [{ ticketTypeId: ctx.ticketType.id, quantity, unitPrice: 1000, subtotal: ticketsSubtotal }] },
        },
    });
    const tickets = [];
    for (let i = 0; i < (status === "CONFIRMED" ? quantity : 0); i++) {
        tickets.push(
            await prisma.ticket.create({
                data: {
                    ticketNumber: `REV-${uniqueSuffix()}-${i}`,
                    saleId: sale.id,
                    eventId: ctx.event.id,
                    functionId: ctx.eventFunction.id,
                    ticketTypeId: ctx.ticketType.id,
                    buyerId: ctx.buyer.id,
                    ownerId: ctx.buyer.id,
                    origin,
                    status: ticketStatuses[i] ?? "ACTIVE",
                },
            })
        );
    }
    return { sale, tickets };
}

async function cleanup(ctx) {
    await prisma.ticketAuditLog.deleteMany({ where: { ticket: { eventId: ctx.event.id } } });
    await prisma.developerAlertReversalEvent.deleteMany({ where: { organizationId: ctx.org.id } });
    await prisma.ticket.deleteMany({ where: { eventId: ctx.event.id } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: ctx.event.id } } });
    await prisma.sale.deleteMany({ where: { eventId: ctx.event.id } });
    await prisma.ticketType.deleteMany({ where: { eventId: ctx.event.id } });
    await prisma.eventFunction.deleteMany({ where: { eventId: ctx.event.id } });
    await prisma.event.deleteMany({ where: { id: ctx.event.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [ctx.owner.id, ctx.buyer.id] } } });
}

testWithDb("REV-A: recaudación = importe de entradas, nunca el cargo Smarticket", async () => {
    const ctx = await setup();
    try {
        const { sale } = await createSale(ctx, { quantity: 2 });
        const r = (await getRevenueBreakdownBySaleId([sale])).get(sale.id);
        assert.deepEqual(r, { ticketsAmount: 2000, serviceFee: 300, refundedAmount: 0, netRevenue: 2000, reversed: false });
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-B: venta vieja sin desglose (ticketsSubtotal null) usa total", async () => {
    const ctx = await setup();
    try {
        const { sale } = await createSale(ctx, { quantity: 3, legacy: true });
        assert.equal((await getRevenueBreakdownBySaleId([sale])).get(sale.id).netRevenue, 3000);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-C: PENDING / CANCELLED / EXPIRED y cortesías no suman", async () => {
    const ctx = await setup();
    try {
        const sales = [];
        for (const status of ["PENDING", "CANCELLED", "EXPIRED"]) sales.push((await createSale(ctx, { status })).sale);
        sales.push((await createSale(ctx, { origin: "COURTESY" })).sale);
        const map = await getRevenueBreakdownBySaleId(sales);
        for (const sale of sales) assert.equal(map.get(sale.id).netRevenue, 0);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-D: reembolso de Mercado Pago (tickets REFUNDED) => revertida, 0 de recaudación", async () => {
    const ctx = await setup();
    try {
        const { sale } = await createSale(ctx, { quantity: 2, ticketStatuses: ["REFUNDED", "REFUNDED"] });
        const r = (await getRevenueBreakdownBySaleId([sale])).get(sale.id);
        assert.equal(r.reversed, true);
        assert.equal(r.refundedAmount, 2000);
        assert.equal(r.netRevenue, 0);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-E: contracargo con tickets ya USED (sólo queda la fila de reversión) => revertida igual", async () => {
    const ctx = await setup();
    try {
        const { sale } = await createSale(ctx, { quantity: 2, ticketStatuses: ["USED", "USED"] });
        await prisma.developerAlertReversalEvent.create({ data: { organizationId: ctx.org.id, saleId: sale.id, type: "CHARGED_BACK" } });
        const r = (await getRevenueBreakdownBySaleId([sale])).get(sale.id);
        assert.equal(r.reversed, true);
        assert.equal(r.netRevenue, 0);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-F: devolución por arrepentimiento de 1 de 3 entradas => descuenta sólo esa", async () => {
    const ctx = await setup();
    try {
        const { sale, tickets } = await createSale(ctx, { quantity: 3, ticketStatuses: ["CANCELLED", "ACTIVE", "ACTIVE"] });
        await prisma.ticketAuditLog.create({
            data: { ticketId: tickets[0].id, action: "CANCEL", fromStatus: "ACTIVE", toStatus: "CANCELLED", actorType: "ORGANIZER", metadata: { source: "WITHDRAWAL_REQUEST_RETURN" } },
        });
        const r = (await getRevenueBreakdownBySaleId([sale])).get(sale.id);
        assert.equal(r.reversed, false);
        assert.equal(r.refundedAmount, 1000);
        assert.equal(r.netRevenue, 2000);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-G: una cancelación manual (no devolución) no descuenta recaudación", async () => {
    const ctx = await setup();
    try {
        const { sale, tickets } = await createSale(ctx, { quantity: 2, ticketStatuses: ["CANCELLED", "ACTIVE"] });
        await prisma.ticketAuditLog.create({
            data: { ticketId: tickets[0].id, action: "CANCEL", fromStatus: "ACTIVE", toStatus: "CANCELLED", actorType: "ORGANIZER", reason: "Corrección" },
        });
        assert.equal((await getRevenueBreakdownBySaleId([sale])).get(sale.id).netRevenue, 2000);
    } finally {
        await cleanup(ctx);
    }
});

testWithDb("REV-H: listado de ventas del organizador y resumen por evento dan el mismo número", async () => {
    const ctx = await setup();
    try {
        await createSale(ctx, { quantity: 2 }); // 2000
        await createSale(ctx, { quantity: 1, ticketStatuses: ["REFUNDED"] }); // 0
        await createSale(ctx, { status: "PENDING" }); // 0
        const listed = await listSalesOrganizerService(ctx.owner.clerkId, { eventId: ctx.event.id });
        const fromList = listed.filter((s) => s.status === "CONFIRMED").reduce((sum, s) => sum + s.revenue.netRevenue, 0);
        const byEvent = (await getNetRevenueByEventId([ctx.event.id])).get(ctx.event.id);
        assert.equal(fromList, 2000);
        assert.equal(byEvent, 2000);
        assert.ok(listed.every((s) => s.revenue), "cada venta del listado trae su desglose");
    } finally {
        await cleanup(ctx);
    }
});
