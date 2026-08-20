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

// Ronda de endurecimiento — MP-6 agregó ticketsSubtotal/serviceFee (Sale) y
// serviceFeeUnit/serviceFeeSubtotal (SaleItem), todos NULL para MANUAL/
// Courtesy y para cualquier Sale anterior a esa migración (nunca hay
// backfill retroactivo, ver el comentario de la migración). createSale de
// arriba ya construye exactamente esa forma (no setea ninguno de esos
// campos) — se reusa tal cual acá, más un SaleItem explícito con los
// mismos cuatro campos en NULL.

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

// ==================================================================
// Ronda de endurecimiento — ventas históricas (anteriores a MP-6) o
// MANUAL/Courtesy: ticketsSubtotal/serviceFee (Sale) y serviceFeeUnit/
// serviceFeeSubtotal (SaleItem) NULL, nunca backfillados. Developer >
// Ventas debe poder listarlas y ver su detalle sin romperse ni inventar un
// desglose de comisión que nunca existió — sólo total (y subtotal/
// unitPrice por ítem) siguen disponibles como siempre.
// ==================================================================

testWithDb("historical sales with NULL ticketsSubtotal/serviceFee/serviceFeeUnit/serviceFeeSubtotal list and render safely in Developer > Ventas, without asserting a breakdown that doesn't exist", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction } = await createEventWithFunction(org.id, owner.id);
    const buyer = await createGuestBuyer();
    const ticketType = await prisma.ticketType.create({
        data: { eventId: event.id, name: "General", price: 15000, quantity: 100, maxPerPurchase: 10 },
    });

    const historicalSale = await createSale({ event, eventFunction, buyer, status: "CONFIRMED", total: 15000 });
    const saleItem = await prisma.saleItem.create({
        data: {
            saleId: historicalSale.id,
            ticketTypeId: ticketType.id,
            quantity: 1,
            unitPrice: 15000,
            subtotal: 15000,
            // serviceFeeUnit/serviceFeeSubtotal se dejan sin setear a
            // propósito: NULL, exactamente como cualquier fila anterior a
            // esta migración (ver el comentario de la migración).
        },
    });

    try {
        const listed = await listDeveloperSalesService({ eventId: event.id });
        const listedSale = listed.items.find((item) => item.id === historicalSale.id);
        assert.ok(listedSale);
        assert.equal(listedSale.ticketsSubtotal, null, "una venta histórica nunca debe inventar un ticketsSubtotal que no fotografió al momento de la compra");
        assert.equal(listedSale.serviceFee, null);
        assert.equal(listedSale.total, 15000, "el total sí sigue disponible siempre, histórico o no");

        const detail = await getDeveloperSaleService(historicalSale.id);
        assert.equal(detail.ticketsSubtotal, null);
        assert.equal(detail.serviceFee, null);
        assert.equal(detail.total, 15000);

        const detailItem = detail.items.find((item) => item.id === saleItem.id);
        assert.ok(detailItem);
        assert.equal(detailItem.serviceFeeUnit, null, "un SaleItem histórico nunca debe inventar una comisión unitaria que no existió");
        assert.equal(detailItem.serviceFeeSubtotal, null);
        assert.equal(detailItem.unitPrice, 15000, "unitPrice/subtotal siguen disponibles siempre, no dependen de la comisión");
        assert.equal(detailItem.subtotal, 15000);
    } finally {
        // cleanup() ya borra SaleItem/Sale por eventId, y TicketType cae en
        // cascada al borrar el Event (onDelete: Cascade) — nada que limpiar
        // aparte acá.
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});
