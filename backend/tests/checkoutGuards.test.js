import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import { VERIFIED_SALE_OPTIONS, verifiedPaymentEvidenceFor } from "./helpers/verifiedPayment.js";

// Ronda de preparación para producción — C1 (sobreventa por líneas
// repetidas), C2 (estados de evento/función/organización) y pagos tardíos
// sobre reservas vencidas. Postgres real (ver tests/helpers/dbGuard.js).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 9).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createOwnerAndOrg(orgOverrides = {}) {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Owner", role: "ORGANIZER" },
    });
    const org = await prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id, ...orgOverrides },
    });
    return { owner, org };
}

async function createEvent(orgId, createdBy, { eventOverrides = {}, functionOverrides = {}, quantity = 10, maxPerPurchase = 6 } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: orgId, createdBy, status: "PUBLISHED", visibility: "PUBLIC", ...eventOverrides },
    });
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date, endAt: new Date(date.getTime() + 3 * 60 * 60 * 1000), venue: "Teatro", status: "SCHEDULED", ...functionOverrides },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 1000, quantity, maxPerPurchase } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

async function createBuyer() {
    const suffix = uniqueSuffix();
    return prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", lastName: "Test" } });
}

function saleInput(ctx, items) {
    return { eventId: ctx.event.id, functionId: ctx.eventFunction.id, items, buyerDocument: "30111222" };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function expectCode(promise, code) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.code, code);
        return true;
    });
}

async function saleCount(eventId) {
    return prisma.sale.count({ where: { eventId } });
}

// ------------------------------------------------------------------
// C1 — líneas repetidas / máximo por compra / cupo
// ------------------------------------------------------------------

testWithDb("C1-A: el mismo ticketTypeId repetido en items se rechaza con DUPLICATE_SALE_ITEM y no crea Sale", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 10, maxPerPurchase: 6 });
    const buyer = await createBuyer();
    try {
        // 5 + 5 = 10: cada línea por separado respetaba maxPerPurchase (6)
        // y el cupo (10) — antes de esta ronda se creaba la venta.
        await expectCode(
            createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 5 }, { ticketTypeId: ctx.ticketType.id, quantity: 5 }]), VERIFIED_SALE_OPTIONS),
            "DUPLICATE_SALE_ITEM"
        );
        assert.equal(await saleCount(ctx.event.id), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("C1-B: superar maxPerPurchase en una sola línea se rechaza", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 10, maxPerPurchase: 4 });
    const buyer = await createBuyer();
    try {
        await expectCode(createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 5 }]), VERIFIED_SALE_OPTIONS), "MAX_PER_PURCHASE_EXCEEDED");
        assert.equal(await saleCount(ctx.event.id), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("C1-C: cantidades inválidas (0, negativa, decimal, string, ticketTypeId no-string) se rechazan con INVALID_SALE_ITEM", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id);
    const buyer = await createBuyer();
    try {
        for (const item of [
            { ticketTypeId: ctx.ticketType.id, quantity: 0 },
            { ticketTypeId: ctx.ticketType.id, quantity: -1 },
            { ticketTypeId: ctx.ticketType.id, quantity: 1.5 },
            { ticketTypeId: ctx.ticketType.id, quantity: "2" },
            { ticketTypeId: { in: [ctx.ticketType.id] }, quantity: 1 },
        ]) {
            await expectCode(createSaleForBuyer(buyer, saleInput(ctx, [item]), VERIFIED_SALE_OPTIONS), "INVALID_SALE_ITEM");
        }
        assert.equal(await saleCount(ctx.event.id), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("C1-D: compras simultáneas nunca reservan más que el cupo (reservas PENDING cuentan)", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 5, maxPerPurchase: 2 });
    const buyers = await Promise.all(Array.from({ length: 6 }, () => createBuyer()));
    try {
        const results = await Promise.allSettled(
            buyers.map((buyer) => createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 2 }]), VERIFIED_SALE_OPTIONS))
        );
        const ok = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        // cupo 5, de a 2: entran exactamente 2 compras (4 lugares).
        assert.equal(ok.length, 2);
        for (const r of rejected) assert.equal(r.reason.code, "INSUFFICIENT_STOCK");
        const reserved = await prisma.saleItem.aggregate({ where: { sale: { eventId: ctx.event.id, status: "PENDING" } }, _sum: { quantity: true } });
        assert.equal(reserved._sum.quantity, 4);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, ...buyers.map((b) => b.id)] });
    }
});

testWithDb("C1-E: una Sale PENDING vieja con líneas repetidas no puede confirmarse por encima de maxPerPurchase (defensa en confirmSaleService)", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 10, maxPerPurchase: 6 });
    const buyer = await createBuyer();
    try {
        // Fila armada a mano, como la habría dejado el código anterior.
        const sale = await prisma.sale.create({
            data: {
                status: "PENDING",
                paymentMethod: "MERCADO_PAGO",
                total: 10000,
                buyerId: buyer.id,
                eventId: ctx.event.id,
                functionId: ctx.eventFunction.id,
                stockReservedUntil: new Date(Date.now() + 10 * 60 * 1000),
                items: {
                    create: [
                        { ticketTypeId: ctx.ticketType.id, quantity: 5, unitPrice: 1000, subtotal: 5000 },
                        { ticketTypeId: ctx.ticketType.id, quantity: 5, unitPrice: 1000, subtotal: 5000 },
                    ],
                },
            },
        });
        await expectCode(confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(sale) }), "MAX_PER_PURCHASE_EXCEEDED");
        const after = await prisma.sale.findUnique({ where: { id: sale.id } });
        assert.equal(after.status, "PENDING", "rollback completo");
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// ------------------------------------------------------------------
// Pago tardío — la reserva propia venció y otro comprador reservó el lugar
// ------------------------------------------------------------------

testWithDb("RES-A: pago aprobado sobre una reserva VENCIDA no le quita el lugar a otro comprador con reserva vigente", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 2, maxPerPurchase: 2 });
    const lateBuyer = await createBuyer();
    const onTimeBuyer = await createBuyer();
    try {
        const lateSale = await createSaleForBuyer(lateBuyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 2 }]), VERIFIED_SALE_OPTIONS);
        // Vence la reserva del primero; el segundo reserva los mismos 2 lugares.
        await prisma.sale.update({ where: { id: lateSale.id }, data: { stockReservedUntil: new Date(Date.now() - 60 * 1000) } });
        const onTimeSale = await createSaleForBuyer(onTimeBuyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 2 }]), VERIFIED_SALE_OPTIONS);

        // Llega tarde el pago del primero: no hay lugar libre para él.
        await expectCode(confirmSaleService(owner.clerkId, lateSale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(lateSale) }), "INSUFFICIENT_STOCK");
        assert.equal((await prisma.sale.findUnique({ where: { id: lateSale.id } })).status, "PENDING");
        assert.equal(await prisma.ticket.count({ where: { saleId: lateSale.id } }), 0, "nunca se emite una entrada sin lugar");

        // El comprador que respetó su ventana confirma normalmente.
        const confirmed = await confirmSaleService(owner.clerkId, onTimeSale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(onTimeSale) });
        assert.equal(confirmed.sale.status, "CONFIRMED");
        assert.equal(await prisma.ticket.count({ where: { saleId: onTimeSale.id } }), 2);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, lateBuyer.id, onTimeBuyer.id] });
    }
});

testWithDb("RES-B: pago aprobado sobre una reserva vencida SÍ confirma si todavía hay lugar libre", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 4, maxPerPurchase: 2 });
    const buyer = await createBuyer();
    try {
        const sale = await createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 2 }]), VERIFIED_SALE_OPTIONS);
        await prisma.sale.update({ where: { id: sale.id }, data: { stockReservedUntil: new Date(Date.now() - 60 * 1000) } });
        const confirmed = await confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(sale) });
        assert.equal(confirmed.sale.status, "CONFIRMED");
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 2);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// ------------------------------------------------------------------
// C2 — estados
// ------------------------------------------------------------------

const STATE_CASES = [
    { name: "evento DRAFT", eventOverrides: { status: "DRAFT" }, code: "EVENT_NOT_ON_SALE" },
    { name: "evento FINISHED", eventOverrides: { status: "FINISHED" }, code: "EVENT_NOT_ON_SALE" },
    { name: "evento CANCELLED", eventOverrides: { status: "CANCELLED", cancelledAt: new Date() }, code: "EVENT_CANCELLED" },
    { name: "evento PUBLISHED con cancelledAt", eventOverrides: { cancelledAt: new Date() }, code: "EVENT_CANCELLED" },
    { name: "evento archivado", eventOverrides: { archivedAt: new Date() }, code: "EVENT_ARCHIVED" },
    { name: "evento PRIVATE", eventOverrides: { visibility: "PRIVATE" }, code: "EVENT_NOT_ON_SALE" },
    { name: "función CANCELLED", functionOverrides: { status: "CANCELLED" }, code: "FUNCTION_CANCELLED" },
    { name: "organización SUSPENDED", orgOverrides: { status: "SUSPENDED" }, code: "EVENT_NOT_ON_SALE" },
    { name: "organización PENDING", orgOverrides: { status: "PENDING" }, code: "EVENT_NOT_ON_SALE" },
    { name: "organización REJECTED", orgOverrides: { status: "REJECTED" }, code: "EVENT_NOT_ON_SALE" },
    { name: "organización cerrada (closedAt)", orgOverrides: { closedAt: new Date() }, code: "EVENT_NOT_FOUND" },
];

for (const c of STATE_CASES) {
    testWithDb(`C2: ${c.name} => venta pública rechazada con ${c.code}, sin Sale ni reserva`, async () => {
        const { owner, org } = await createOwnerAndOrg(c.orgOverrides);
        const ctx = await createEvent(org.id, owner.id, { eventOverrides: c.eventOverrides, functionOverrides: c.functionOverrides });
        const buyer = await createBuyer();
        try {
            await expectCode(createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }]), VERIFIED_SALE_OPTIONS), c.code);
            assert.equal(await saleCount(ctx.event.id), 0);
        } finally {
            await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
        }
    });
}

testWithDb("C2: evento PUBLISHED + PUBLIC de organización APPROVED => la venta pública se crea", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id);
    const buyer = await createBuyer();
    try {
        const sale = await createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }]), VERIFIED_SALE_OPTIONS);
        assert.equal(sale.status, "PENDING");
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("C2: cortesía (origin COURTESY) sigue permitida en un evento DRAFT o PRIVATE, pero no en uno cancelado ni de una organización suspendida", async () => {
    const created = [];
    try {
        for (const [eventOverrides, orgOverrides, expected] of [
            [{ status: "DRAFT" }, {}, "OK"],
            [{ visibility: "PRIVATE" }, {}, "OK"],
            [{ status: "CANCELLED", cancelledAt: new Date() }, {}, "EVENT_CANCELLED"],
            [{}, { status: "SUSPENDED" }, "EVENT_NOT_ON_SALE"],
        ]) {
            const { owner, org } = await createOwnerAndOrg(orgOverrides);
            const ctx = await createEvent(org.id, owner.id, { eventOverrides });
            created.push({ ctx, org, owner });
            const promise = createSaleForBuyer(
                owner,
                { eventId: ctx.event.id, functionId: ctx.eventFunction.id, items: [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }] },
                { origin: "COURTESY", requireBuyerDocument: false, enforceMaxPerPurchase: false }
            );
            if (expected === "OK") {
                assert.equal((await promise).status, "PENDING");
            } else {
                await expectCode(promise, expected);
            }
        }
    } finally {
        await cleanup({
            eventIds: created.map((c) => c.ctx.event.id),
            organizationIds: created.map((c) => c.org.id),
            userIds: created.map((c) => c.owner.id),
        });
    }
});

testWithDb("GUEST: dos compras simultáneas con el mismo email nuevo reutilizan un único User (sin 500 por P2002)", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id, { quantity: 20, maxPerPurchase: 2 });
    const { createGuestSaleService } = await import("../src/services/sale.service.js");
    const email = `race_${uniqueSuffix()}@example.com`;
    try {
        const results = await Promise.allSettled(
            Array.from({ length: 4 }, () =>
                createGuestSaleService({ firstName: "Ana", lastName: "Paz", email }, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }]), VERIFIED_SALE_OPTIONS)
            )
        );
        for (const r of results) assert.equal(r.status, "fulfilled", r.reason?.message);
        assert.equal(await prisma.user.count({ where: { email } }), 1);
    } finally {
        const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, ...users.map((u) => u.id)] });
    }
});

testWithDb("CANCEL-A: evento cancelado con una compra en curso => el pago aprobado NO emite entradas (queda PENDING para revisión)", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id);
    const buyer = await createBuyer();
    try {
        const sale = await createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }]), VERIFIED_SALE_OPTIONS);
        await prisma.event.update({ where: { id: ctx.event.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
        await expectCode(confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(sale) }), "EVENT_CANCELLED");
        assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).status, "PENDING");
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("CANCEL-B: función cancelada con una compra en curso => tampoco emite entradas", async () => {
    const { owner, org } = await createOwnerAndOrg();
    const ctx = await createEvent(org.id, owner.id);
    const buyer = await createBuyer();
    try {
        const sale = await createSaleForBuyer(buyer, saleInput(ctx, [{ ticketTypeId: ctx.ticketType.id, quantity: 1 }]), VERIFIED_SALE_OPTIONS);
        await prisma.eventFunction.update({ where: { id: ctx.eventFunction.id }, data: { status: "CANCELLED" } });
        await expectCode(confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true, paymentEvidence: verifiedPaymentEvidenceFor(sale) }), "FUNCTION_CANCELLED");
        assert.equal(await prisma.ticket.count({ where: { saleId: sale.id } }), 0);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});
