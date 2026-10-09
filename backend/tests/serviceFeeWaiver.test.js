import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { updateMyEventService, getPublicEventBySlugService, getPublicEventsService, getQuickPassBySlugService } from "../src/services/event.service.js";
import { createSaleForBuyer } from "../src/services/sale.service.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { replaceServiceFeeTiers } from "../src/services/serviceFee.service.js";
import { encryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";
import { getPublicServiceFeeTiers } from "../src/controllers/sale.controller.js";
import {
    addCalendarMonths,
    getServiceFeeWaiverDurationMonths,
    recordFirstEventPublication,
    renewServiceFeeWaiverService,
    setServiceFeeWaiverDurationService,
} from "../src/services/serviceFeeWaiver.service.js";

// Beneficio para compradores (cargo de servicio $0 durante 1 mes desde la
// primera publicación, renovable desde Developer) — publicación real
// (updateMyEventService), checkout real (createSaleForBuyer /
// createMercadoPagoCheckoutService con fetch mockeado) y renovación,
// contra Postgres real. Guardrail centralizado: tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.FRONTEND_URL = "https://pasecultural.test";

// Escala vigente en producción al 2026-10-08 (sólo se usa como fixture).
const LIVE_TIERS = [
    { minAmount: 0, maxAmount: 1000, feeAmount: 1 },
    { minAmount: 1000, maxAmount: 5000, feeAmount: 150 },
    { minAmount: 5000, maxAmount: 10000, feeAmount: 200 },
    { minAmount: 10000, maxAmount: 50000, feeAmount: 1000 },
    { minAmount: 50000, maxAmount: null, feeAmount: 2000 },
];

const created = { eventIds: [], organizationIds: [], userIds: [] };
const suffix = () => randomUUID().slice(0, 8);

async function createOwner() {
    const s = suffix();
    const user = await prisma.user.create({
        data: { clerkId: `clerk_${s}`, email: `owner_${s}@example.com`, firstName: "Nadia", role: "ORGANIZER" },
    });
    created.userIds.push(user.id);
    return user;
}

async function createOrg(overrides = {}) {
    const owner = await createOwner();
    const s = suffix();
    const organization = await prisma.organization.create({
        data: { name: `Sala ${s}`, email: `org_${s}@example.com`, status: "APPROVED", plan: "PREMIUM", ownerId: owner.id, ...overrides },
    });
    created.organizationIds.push(organization.id);
    return { owner, organization, context: { user: owner, organization } };
}

// Evento ya publicado para las compras: desde la ronda de preparación para
// producción, createSaleForBuyer rechaza ventas públicas sobre un DRAFT
// (EVENT_NOT_ON_SALE). El beneficio depende de la organización
// (serviceFeeWaivedUntil), nunca del estado del evento — así que esto no
// cambia nada de lo que estos tests prueban.
function createSellableEvent(organization, owner, options = {}) {
    return createDraftEvent(organization, owner, { ...options, status: "PUBLISHED" });
}

async function createDraftEvent(organization, owner, { price = 10000, status = "DRAFT", publishedAt = null } = {}) {
    const s = suffix();
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const event = await prisma.event.create({
        data: {
            title: `Show ${s}`,
            slug: `show-${s}`,
            organizationId: organization.id,
            createdBy: owner.id,
            status,
            publishedAt,
            visibility: "PUBLIC",
            venueName: "Teatro de prueba",
            formattedAddress: "Calle 123",
        },
    });
    created.eventIds.push(event.id);
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date, endAt: new Date(date.getTime() + 2 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price, quantity: 100, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

const publish = (ctx, event) => updateMyEventService(ctx.owner.clerkId, event.id, { status: "PUBLISHED" }, ctx.organization.id, { context: ctx.context });
const unpublish = (ctx, event) => updateMyEventService(ctx.owner.clerkId, event.id, { status: "DRAFT" }, ctx.organization.id, { context: ctx.context });
const readOrg = (id) => prisma.organization.findUnique({ where: { id }, select: { firstEventPublishedAt: true, serviceFeeWaivedUntil: true } });
const setWaiver = (id, serviceFeeWaivedUntil, firstEventPublishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000)) =>
    prisma.organization.update({ where: { id }, data: { serviceFeeWaivedUntil, firstEventPublishedAt } });

async function buyer() {
    const s = suffix();
    const user = await prisma.user.create({ data: { clerkId: `guest_${s}`, email: `buyer_${s}@example.com`, firstName: "Compradora", role: "CUSTOMER" } });
    created.userIds.push(user.id);
    return user;
}

const saleInput = ({ event, eventFunction, ticketType }, quantity = 2) => ({
    eventId: event.id,
    functionId: eventFunction.id,
    items: [{ ticketTypeId: ticketType.id, quantity }],
    buyerDocument: "30111222",
});

// service_fee_settings es GLOBAL (fila única): se fija en 1 mes para todo
// el archivo y cada test que la cambia la vuelve a 1 en un finally. Al
// final se restaura el valor original.
const setDuration = (months) => prisma.serviceFeeSettings.updateMany({ data: { serviceFeeWaiverDurationMonths: months } });
async function withDuration(months, fn) {
    await setDuration(months);
    try {
        return await fn();
    } finally {
        await setDuration(1);
    }
}

let originalTiers = [];
let originalDuration = null;
test.before(async () => {
    if (!hasDatabase) return;
    originalDuration = (await prisma.serviceFeeSettings.findFirst({ orderBy: { createdAt: "asc" } }))?.serviceFeeWaiverDurationMonths ?? null;
    await setDuration(1);
    originalTiers = (await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } })).map((t) => ({
        minAmount: Number(t.minAmount),
        maxAmount: t.maxAmount == null ? null : Number(t.maxAmount),
        feeAmount: Number(t.feeAmount),
    }));
    await replaceServiceFeeTiers(LIVE_TIERS, null);
});

test.after(async () => {
    if (!hasDatabase) return;
    const { eventIds, organizationIds, userIds } = created;
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.mercadoPagoConnection.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (originalTiers.length > 0) await replaceServiceFeeTiers(originalTiers, null);
    if (originalDuration !== null) await setDuration(originalDuration);
    await prisma.$disconnect();
});

// ---------------------------------------------------------------- publicación

testWithDb("organización sin publicación: ambas fechas null (SIN INICIAR)", async () => {
    const ctx = await createOrg();
    await createDraftEvent(ctx.organization, ctx.owner);
    assert.deepEqual(await readOrg(ctx.organization.id), { firstEventPublishedAt: null, serviceFeeWaivedUntil: null });
});

testWithDb("primer evento: setea firstEventPublishedAt = publishedAt y serviceFeeWaivedUntil = +1 mes calendario", async () => {
    const ctx = await createOrg();
    const first = await createDraftEvent(ctx.organization, ctx.owner);
    const published = await publish(ctx, first.event);
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.firstEventPublishedAt.toISOString(), published.publishedAt.toISOString());
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(published.publishedAt, 1).toISOString());
});

testWithDb("segundo evento, despublicar/republicar y borrar eventos NO modifican las fechas", async () => {
    const ctx = await createOrg();
    const first = await createDraftEvent(ctx.organization, ctx.owner);
    await publish(ctx, first.event);
    const before = await readOrg(ctx.organization.id);

    const second = await createDraftEvent(ctx.organization, ctx.owner);
    await publish(ctx, second.event);
    assert.deepEqual(await readOrg(ctx.organization.id), before, "segundo evento");

    await unpublish(ctx, first.event);
    await publish(ctx, first.event);
    assert.deepEqual(await readOrg(ctx.organization.id), before, "despublicar/republicar");

    // Hard delete del primer evento publicado (sin ventas), como deleteMyEventService.
    await prisma.event.delete({ where: { id: first.event.id } });
    const third = await createDraftEvent(ctx.organization, ctx.owner);
    await publish(ctx, third.event);
    assert.deepEqual(await readOrg(ctx.organization.id), before, "borrar eventos y publicar otro");
});

testWithDb("publicación simultánea de dos eventos: la fecha se escribe una sola vez y queda consistente", async () => {
    const ctx = await createOrg();
    const a = await createDraftEvent(ctx.organization, ctx.owner);
    const b = await createDraftEvent(ctx.organization, ctx.owner);
    const [pa, pb] = await Promise.all([publish(ctx, a.event), publish(ctx, b.event)]);
    const org = await readOrg(ctx.organization.id);
    const candidates = [pa.publishedAt.toISOString(), pb.publishedAt.toISOString()];
    assert.ok(candidates.includes(org.firstEventPublishedAt.toISOString()));
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(org.firstEventPublishedAt, 1).toISOString());
});

testWithDb("registro concurrente directo (10 transacciones): nunca pisa la primera fecha", async () => {
    const ctx = await createOrg();
    const { event } = await createDraftEvent(ctx.organization, ctx.owner, { status: "PUBLISHED", publishedAt: new Date("2026-10-01T15:00:00Z") });
    await Promise.all(
        Array.from({ length: 10 }, () => prisma.$transaction((tx) => recordFirstEventPublication(tx, ctx.organization.id)))
    );
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.firstEventPublishedAt.toISOString(), "2026-10-01T15:00:00.000Z");
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), "2026-11-01T15:00:00.000Z");
    assert.ok(event);
});

testWithDb("organización antigua sin backfill: publicar otro evento usa su publicación real, no regala un mes", async () => {
    const ctx = await createOrg();
    const oldDate = new Date("2026-09-15T13:00:00Z");
    await createDraftEvent(ctx.organization, ctx.owner, { status: "PUBLISHED", publishedAt: oldDate });
    const fresh = await createDraftEvent(ctx.organization, ctx.owner);
    await publish(ctx, fresh.event);
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.firstEventPublishedAt.toISOString(), oldDate.toISOString());
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), "2026-10-15T13:00:00.000Z");
});

testWithDb("organización antigua con PUBLISHED sin publishedAt: fallback createdAt del más antiguo", async () => {
    const ctx = await createOrg();
    const legacy = await createDraftEvent(ctx.organization, ctx.owner, { status: "PUBLISHED", publishedAt: null });
    await prisma.$transaction((tx) => recordFirstEventPublication(tx, ctx.organization.id));
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.firstEventPublishedAt.toISOString(), legacy.event.createdAt.toISOString());
});

// ---------------------------------------------------------------- checkout

testWithDb("compra dentro del beneficio: Sale y SaleItem con cargo $0, total = entradas", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 25000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const sale = await createSaleForBuyer(await buyer(), saleInput(fixture), { applyServiceFee: true });
    assert.equal(Number(sale.ticketsSubtotal), 50000);
    assert.equal(Number(sale.serviceFee), 0);
    assert.equal(Number(sale.total), 50000);
    const [item] = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    assert.equal(Number(item.serviceFeeUnit), 0);
    assert.equal(Number(item.serviceFeeSubtotal), 0);
    assert.equal(Number(item.unitPrice), 25000);
});

testWithDb("justo antes del vencimiento: $0", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 25000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() + 5000));
    const sale = await createSaleForBuyer(await buyer(), saleInput(fixture, 1), { applyServiceFee: true });
    assert.equal(Number(sale.serviceFee), 0);
});

testWithDb("vencido (ya pasó serviceFeeWaivedUntil): tier normal en Sale y SaleItem", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 25000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() - 1));
    const sale = await createSaleForBuyer(await buyer(), saleInput(fixture), { applyServiceFee: true });
    assert.equal(Number(sale.serviceFee), 2000);
    assert.equal(Number(sale.total), 52000);
    const [item] = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    assert.equal(Number(item.serviceFeeUnit), 1000);
});

testWithDb("sin beneficio (nunca publicó): usa los rangos — límites de todos los tiers", async () => {
    const ctx = await createOrg();
    const cases = [[1, 1], [999, 1], [1000, 150], [4999, 150], [5000, 200], [9999, 200], [10000, 1000], [49999, 1000], [50000, 2000], [150000, 2000]];
    for (const [price, fee] of cases) {
        const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price });
        const sale = await createSaleForBuyer(await buyer(), saleInput(fixture, 1), { applyServiceFee: true });
        assert.equal(Number(sale.serviceFee), fee, `precio ${price}`);
        assert.equal(Number(sale.total), price + fee, `total ${price}`);
    }
});

testWithDb("expectedTotals: con beneficio, $0 confirmado pasa; un cargo estimado viejo devuelve SERVICE_FEE_CHANGED con $0", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 10000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() + 60 * 60 * 1000));
    const ok = await createSaleForBuyer(await buyer(), saleInput(fixture, 1), {
        applyServiceFee: true,
        expectedTotals: { ticketsSubtotal: 10000, serviceFee: 0, total: 10000 },
    });
    assert.equal(Number(ok.total), 10000);
    await assert.rejects(
        createSaleForBuyer(await buyer(), saleInput(fixture, 1), {
            applyServiceFee: true,
            expectedTotals: { ticketsSubtotal: 10000, serviceFee: 1000, total: 11000 },
        }),
        (error) => error.code === "SERVICE_FEE_CHANGED" && Number(error.details.serviceFee) === 0 && Number(error.details.total) === 10000
    );
});

testWithDb("venta manual / cortesía (applyServiceFee=false) sigue igual: sin desglose de cargo", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 10000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() + 60 * 60 * 1000));
    const sale = await createSaleForBuyer(await buyer(), saleInput(fixture, 1));
    assert.equal(sale.serviceFee, null);
    assert.equal(Number(sale.total), 10000);
});

// ---------------------------------------------------------------- Mercado Pago

async function checkoutCapturingPreference(ctx, fixture) {
    await prisma.mercadoPagoConnection.create({
        data: {
            organizationId: ctx.organization.id,
            mercadoPagoUserId: `mp_${suffix()}`,
            accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS"),
            refreshTokenEncrypted: encryptMercadoPagoSecret("REFRESH"),
            accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            liveMode: false,
        },
    });
    let body = null;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (!String(url).includes("/checkout/preferences")) throw new Error(`unexpected fetch ${url}`);
        body = JSON.parse(init.body);
        return { ok: true, status: 201, json: async () => ({ id: `PREF-${suffix()}`, init_point: "https://mp.test/redirect" }) };
    };
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Nadia", lastName: "Compradora", email: `c_${suffix()}@example.com` },
            saleInput(fixture),
            randomUUID()
        );
        return { result, body };
    } finally {
        globalThis.fetch = original;
    }
}

testWithDb("Mercado Pago con beneficio: marketplace_fee 0, sin ítem de comisión, ítems = total", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 25000 });
    await setWaiver(ctx.organization.id, new Date(Date.now() + 60 * 60 * 1000));
    const { result, body } = await checkoutCapturingPreference(ctx, fixture);
    assert.equal(result.serviceFee, 0);
    assert.equal(body.marketplace_fee, 0);
    assert.equal(body.items.some((i) => i.id === "service-fee"), false);
    assert.equal(body.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0), 50000);
});

testWithDb("Mercado Pago sin beneficio: marketplace_fee = cargo fijo (nunca % de las entradas → organizador $0)", async () => {
    const ctx = await createOrg();
    const fixture = await createSellableEvent(ctx.organization, ctx.owner, { price: 25000 });
    const { result, body } = await checkoutCapturingPreference(ctx, fixture);
    assert.equal(result.serviceFee, 2000);
    assert.equal(body.marketplace_fee, 2000);
    assert.equal(body.items.find((i) => i.id === "service-fee").unit_price, 2000);
    assert.equal(body.items.filter((i) => i.id !== "service-fee").reduce((s, i) => s + i.unit_price * i.quantity, 0), 50000);
});

// ---------------------------------------------------------------- evento público

testWithDb("evento público: informa serviceFeeWaived/serviceFeeWaivedUntil sin exponerlo dentro de organization", async () => {
    const ctx = await createOrg();
    const fixture = await createDraftEvent(ctx.organization, ctx.owner);
    await publish(ctx, fixture.event);
    const active = await getPublicEventBySlugService(fixture.event.slug);
    assert.equal(active.serviceFeeWaived, true);
    assert.ok(active.serviceFeeWaivedUntil instanceof Date);
    assert.equal(Object.hasOwn(active.organization, "serviceFeeWaivedUntil"), false);

    await setWaiver(ctx.organization.id, new Date(Date.now() - 1));
    const expired = await getPublicEventBySlugService(fixture.event.slug);
    assert.equal(expired.serviceFeeWaived, false);
    assert.equal(expired.serviceFeeWaivedUntil, null);
});

// ---------------------------------------------------------------- renovación

testWithDb("renovar beneficio ACTIVO: vencimiento actual + 1 mes; firstEventPublishedAt intacto", async () => {
    const ctx = await createOrg();
    const first = new Date("2026-12-10T15:00:00Z");
    await setWaiver(ctx.organization.id, new Date("2027-01-10T15:00:00Z"), first);
    const renewed = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id, new Date("2027-01-05T15:00:00Z"));
    assert.equal(renewed.serviceFeeWaivedUntil.toISOString(), "2027-02-10T15:00:00.000Z");
    assert.equal(renewed.firstEventPublishedAt.toISOString(), first.toISOString());
});

testWithDb("renovar beneficio VENCIDO: ahora + 1 mes; firstEventPublishedAt intacto", async () => {
    const ctx = await createOrg();
    const first = new Date("2026-12-10T15:00:00Z");
    await setWaiver(ctx.organization.id, new Date("2027-01-10T15:00:00Z"), first);
    const renewed = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id, new Date("2027-01-20T18:30:00Z"));
    assert.equal(renewed.serviceFeeWaivedUntil.toISOString(), "2027-02-20T18:30:00.000Z");
    assert.equal(renewed.firstEventPublishedAt.toISOString(), first.toISOString());
});

testWithDb("renovar SIN INICIAR: error; organización inexistente: null", async () => {
    const ctx = await createOrg();
    await assert.rejects(renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id), (e) => e.code === "SERVICE_FEE_WAIVER_NOT_STARTED");
    assert.equal(await renewServiceFeeWaiverService("no-existe", ctx.owner.id), null);
});

testWithDb("renovaciones simultáneas: cada renovación exitosa suma exactamente 1 mes, nunca una de más", async () => {
    const ctx = await createOrg();
    const until = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await setWaiver(ctx.organization.id, until);
    const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id))
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected");
    assert.ok(fulfilled >= 1);
    assert.ok(rejected.every((r) => r.reason.code === "SERVICE_FEE_WAIVER_CONFLICT"));
    let expected = until;
    for (let i = 0; i < fulfilled; i++) expected = addCalendarMonths(expected, 1);
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), expected.toISOString());
});

// ---------------------------------------------------------------- duración configurable

async function publicEndpointDuration() {
    let body = null;
    await getPublicServiceFeeTiers({}, { status: () => ({ json: (b) => (body = b) }) }, (error) => {
        throw error;
    });
    return body.serviceFeeWaiverDurationMonths;
}

testWithDb("configuración = 1: endpoint público informa 1; primera publicación +1 mes; renovación +1 mes", async () => {
    assert.equal(await publicEndpointDuration(), 1);
    const ctx = await createOrg();
    const { event } = await createDraftEvent(ctx.organization, ctx.owner);
    const published = await publish(ctx, event);
    const org = await readOrg(ctx.organization.id);
    assert.equal(org.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(published.publishedAt, 1).toISOString());
    const renewed = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id);
    assert.equal(renewed.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(org.serviceFeeWaivedUntil, 1).toISOString());
});

testWithDb("configuración = 2: primera publicación +2 meses; renovar activo +2; renovar vencido ahora +2", async () => {
    await withDuration(2, async () => {
        assert.equal(await publicEndpointDuration(), 2);
        const ctx = await createOrg();
        const { event } = await createDraftEvent(ctx.organization, ctx.owner);
        const published = await publish(ctx, event);
        const org = await readOrg(ctx.organization.id);
        assert.equal(org.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(published.publishedAt, 2).toISOString());

        const active = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id);
        assert.equal(active.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(org.serviceFeeWaivedUntil, 2).toISOString());

        await setWaiver(ctx.organization.id, new Date("2027-01-10T15:00:00Z"), org.firstEventPublishedAt);
        const expired = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id, new Date("2027-01-20T18:30:00Z"));
        assert.equal(expired.serviceFeeWaivedUntil.toISOString(), "2027-03-20T18:30:00.000Z");
        assert.equal(expired.firstEventPublishedAt.toISOString(), org.firstEventPublishedAt.toISOString());
    });
});

testWithDb("configuración = 0: guarda firstEventPublishedAt, vencimiento null, checkout cobra tiers, sin promoción pública, sin renovación", async () => {
    await withDuration(0, async () => {
        assert.equal(await publicEndpointDuration(), 0);
        const ctx = await createOrg();
        const fixture = await createDraftEvent(ctx.organization, ctx.owner, { price: 25000 });
        const published = await publish(ctx, fixture.event);
        const org = await readOrg(ctx.organization.id);
        assert.equal(org.firstEventPublishedAt.toISOString(), published.publishedAt.toISOString());
        assert.equal(org.serviceFeeWaivedUntil, null);

        const sale = await createSaleForBuyer(await buyer(), saleInput(fixture), { applyServiceFee: true });
        assert.equal(Number(sale.serviceFee), 2000);
        assert.equal(Number(sale.total), 52000);

        const publicEvent = await getPublicEventBySlugService(fixture.event.slug);
        assert.equal(publicEvent.serviceFeeWaived, false);
        assert.equal(publicEvent.serviceFeeWaivedUntil, null);

        await assert.rejects(renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id), (e) => e.code === "SERVICE_FEE_WAIVER_DISABLED");
        assert.deepEqual(await readOrg(ctx.organization.id), org);
    });
});

testWithDb("cambio de configuración 1 → 2: el beneficio ya iniciado NO cambia; la nueva organización recibe 2; la renovación posterior suma 2", async () => {
    const a = await createOrg();
    const eventA = await createDraftEvent(a.organization, a.owner);
    const publishedA = await publish(a, eventA.event);
    const before = await readOrg(a.organization.id);
    assert.equal(before.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(publishedA.publishedAt, 1).toISOString());

    await withDuration(2, async () => {
        await setServiceFeeWaiverDurationService(a.owner.id, 2);
        assert.deepEqual(await readOrg(a.organization.id), before, "el vencimiento existente no se recalcula");

        const b = await createOrg();
        const eventB = await createDraftEvent(b.organization, b.owner);
        const publishedB = await publish(b, eventB.event);
        const orgB = await readOrg(b.organization.id);
        assert.equal(orgB.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(publishedB.publishedAt, 2).toISOString());

        const renewedA = await renewServiceFeeWaiverService(a.organization.id, a.owner.id);
        assert.equal(renewedA.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(before.serviceFeeWaivedUntil, 2).toISOString());
        assert.equal(renewedA.firstEventPublishedAt.toISOString(), before.firstEventPublishedAt.toISOString());
    });
});

testWithDb("publicó con configuración 0 y después se activa: se le puede otorgar el beneficio desde hoy (+N)", async () => {
    const ctx = await createOrg();
    await withDuration(0, async () => {
        const { event } = await createDraftEvent(ctx.organization, ctx.owner);
        await publish(ctx, event);
    });
    const now = new Date("2026-11-05T12:00:00Z");
    const granted = await renewServiceFeeWaiverService(ctx.organization.id, ctx.owner.id, now);
    assert.equal(granted.serviceFeeWaivedUntil.toISOString(), addCalendarMonths(now, 1).toISOString());
});

testWithDb("Developer > Configuración: valida 0..12 enteros y nunca toca beneficios existentes", async () => {
    const ctx = await createOrg();
    await setWaiver(ctx.organization.id, new Date("2027-01-10T15:00:00Z"), new Date("2026-12-10T15:00:00Z"));
    const before = await readOrg(ctx.organization.id);
    for (const bad of [13, -1, 1.5, "2", null, undefined]) {
        await assert.rejects(setServiceFeeWaiverDurationService(ctx.owner.id, bad), (e) => e.code === "SERVICE_FEE_SETTINGS_INVALID", String(bad));
    }
    try {
        for (const ok of [0, 3, 12]) {
            const saved = await setServiceFeeWaiverDurationService(ctx.owner.id, ok);
            assert.equal(saved.serviceFeeWaiverDurationMonths, ok);
            assert.equal(await getServiceFeeWaiverDurationMonths(), ok);
        }
    } finally {
        await setDuration(1);
    }
    assert.deepEqual(await readOrg(ctx.organization.id), before);
});

testWithDb("sin fila de configuración (borrada a mano): duración 0, nunca un beneficio inventado", async () => {
    const rows = await prisma.serviceFeeSettings.findMany();
    await prisma.serviceFeeSettings.deleteMany({});
    try {
        assert.equal(await getServiceFeeWaiverDurationMonths(), 0);
    } finally {
        for (const row of rows) {
            await prisma.serviceFeeSettings.create({
                data: { id: row.id, serviceFeeWaiverDurationMonths: row.serviceFeeWaiverDurationMonths, createdAt: row.createdAt },
            });
        }
        await setDuration(1);
    }
});

// ---------------------------------------------------------------- listado y Quick Pass (badge "SIN CARGO DE SERVICIO")

testWithDb("listado público y Quick Pass: serviceFeeWaived = mismo booleano que el detalle; nunca fechas ni datos internos", async () => {
    const cases = [];
    // ACTIVO: primera publicación con la duración vigente (1 mes).
    const active = await createOrg();
    const activeEvent = await createDraftEvent(active.organization, active.owner);
    await publish(active, activeEvent.event);
    cases.push({ name: "ACTIVO", event: activeEvent.event, expected: true });
    // VENCIDO.
    const expired = await createOrg();
    const expiredEvent = await createDraftEvent(expired.organization, expired.owner);
    await publish(expired, expiredEvent.event);
    await setWaiver(expired.organization.id, new Date(Date.now() - 1));
    cases.push({ name: "VENCIDO", event: expiredEvent.event, expected: false });
    // SIN INICIAR (publicado por fuera del hook: firstEventPublishedAt null).
    const notStarted = await createOrg();
    const notStartedEvent = await createDraftEvent(notStarted.organization, notStarted.owner, { status: "PUBLISHED", publishedAt: new Date() });
    cases.push({ name: "SIN INICIAR", event: notStartedEvent.event, expected: false });
    // SIN BENEFICIO (publicó con la duración en 0).
    const none = await createOrg();
    const noneEvent = await createDraftEvent(none.organization, none.owner);
    await withDuration(0, () => publish(none, noneEvent.event));
    cases.push({ name: "SIN BENEFICIO", event: noneEvent.event, expected: false });

    for (const c of cases) {
        await prisma.event.update({ where: { id: c.event.id }, data: { quickPassEnabled: true, quickPassImageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg" } });

        const listed = (await getPublicEventsService({ search: c.event.title })).find((e) => e.id === c.event.id);
        assert.ok(listed, `${c.name}: aparece en el listado`);
        assert.equal(listed.serviceFeeWaived, c.expected, `${c.name}: listado`);
        assert.equal(Object.hasOwn(listed, "serviceFeeWaivedUntil"), false, `${c.name}: listado sin fecha`);
        assert.deepEqual(Object.keys(listed.organization).sort(), ["id", "logo", "name"], `${c.name}: organization sin datos internos`);

        const detail = await getPublicEventBySlugService(c.event.slug);
        assert.equal(detail.serviceFeeWaived, c.expected, `${c.name}: detalle`);

        const quickPass = await getQuickPassBySlugService(c.event.slug);
        assert.equal(quickPass.available, true);
        assert.equal(quickPass.event.serviceFeeWaived, c.expected, `${c.name}: Quick Pass`);
        for (const key of ["serviceFeeWaivedUntil", "firstEventPublishedAt", "serviceFeeWaiverDurationMonths", "organization"]) {
            assert.equal(Object.hasOwn(quickPass.event, key), false, `${c.name}: Quick Pass sin ${key}`);
        }
        const json = JSON.stringify([listed, quickPass]);
        assert.equal(/serviceFeeWaivedUntil|firstEventPublishedAt|serviceFeeWaiverDurationMonths/.test(json), false, `${c.name}: nada interno serializado`);
    }
});
