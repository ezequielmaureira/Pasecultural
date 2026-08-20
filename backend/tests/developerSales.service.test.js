import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { listDeveloperSalesService, getDeveloperSaleService } from "../src/services/developerSales.service.js";

// MP-6 (auditoría "pago aprobado después del vencimiento de la reserva de
// stock") — CRUD real, no expresable como funciones puras: se prueba
// contra Postgres real (backend/.env.test), mismo criterio que
// mercadoPagoWebhook.service.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

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

async function createGuestBuyer(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", role: "CUSTOMER", ...overrides },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

async function createEventWithFunction(organizationId, createdBy) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    return { event, eventFunction };
}

// Inserta la Sale directamente (sin pasar por confirmSaleService/checkout):
// developerSales.service.js sólo lee filas, no le importa cómo llegaron a
// ese estado — mismo shortcut que el resto de los tests de este módulo que
// no ejercitan el flujo de pago en sí.
async function createSale({ event, eventFunction, buyer, status = "PENDING", paymentRef = null, total = 15000 }) {
    return prisma.sale.create({
        data: { status, total, paymentRef, buyerId: buyer.id, eventId: event.id, functionId: eventFunction.id },
    });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ==================================================================
// La condición de reconciliación es EXACTAMENTE status=PENDING AND
// paymentRef != null (ver mercadoPagoWebhook.service.js, catch de
// INSUFFICIENT_STOCK) — sin SaleStatus nuevo ni campo nuevo. Estos tests
// cubren que Developer > Ventas la expone tal cual, tanto en el filtro
// como en el flag derivado que ve cada fila/detalle.
// ==================================================================

testWithDb("needsReconciliation filter returns only PENDING sales with a paymentRef set", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction } = await createEventWithFunction(org.id, owner.id);
    const buyer = await createGuestBuyer();

    const stuckPaymentId = `mp-${uniqueSuffix()}`;
    const stuckSale = await createSale({ event, eventFunction, buyer, status: "PENDING", paymentRef: stuckPaymentId });
    const normalPendingSale = await createSale({ event, eventFunction, buyer, status: "PENDING" });
    const confirmedSale = await createSale({ event, eventFunction, buyer, status: "CONFIRMED" });

    try {
        const reconciliationOnly = await listDeveloperSalesService({ eventId: event.id, needsReconciliation: true });
        assert.equal(reconciliationOnly.items.length, 1, "sólo la Sale PENDING con paymentRef debe pasar el filtro");
        assert.equal(reconciliationOnly.items[0].id, stuckSale.id);
        assert.equal(reconciliationOnly.items[0].paymentRef, stuckPaymentId);
        assert.equal(reconciliationOnly.items[0].needsReconciliation, true);

        // Un status explícito distinto no debe colarse cuando needsReconciliation
        // está activo — la condición server-side siempre fuerza PENDING.
        const ignoresConflictingStatus = await listDeveloperSalesService({ eventId: event.id, status: "CONFIRMED", needsReconciliation: true });
        assert.equal(ignoresConflictingStatus.items.length, 1);
        assert.equal(ignoresConflictingStatus.items[0].id, stuckSale.id);

        const all = await listDeveloperSalesService({ eventId: event.id });
        assert.equal(all.items.length, 3);
        const flagById = new Map(all.items.map((item) => [item.id, item.needsReconciliation]));
        assert.equal(flagById.get(stuckSale.id), true);
        assert.equal(flagById.get(normalPendingSale.id), false, "PENDING sin paymentRef no es un caso de conciliación");
        assert.equal(flagById.get(confirmedSale.id), false);

        const stuckDetail = await getDeveloperSaleService(stuckSale.id);
        assert.equal(stuckDetail.paymentRef, stuckPaymentId);
        assert.equal(stuckDetail.needsReconciliation, true);

        const normalDetail = await getDeveloperSaleService(normalPendingSale.id);
        assert.equal(normalDetail.paymentRef, null);
        assert.equal(normalDetail.needsReconciliation, false);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});
