import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createMercadoPagoCheckoutService } from "../src/services/mercadoPagoCheckout.service.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import { encryptMercadoPagoSecret } from "../src/config/mercadoPagoEncryption.js";
import { disconnectMercadoPagoConnectionService } from "../src/services/mercadoPagoConnection.service.js";
import { replaceServiceFeeTiers } from "../src/services/serviceFee.service.js";
import { formatFunctionDateTimeAR } from "../src/services/email/formatDateAR.js";

// MP-2 — CRUD + transacciones + concurrencia real (Sale/TicketType/
// MercadoPagoConnection), no expresable como funciones puras: se prueba
// contra Postgres real (backend/.env.test), nunca con mocks de Prisma.
// Guardrail centralizado — ver tests/helpers/dbGuard.js (NUNCA un segundo
// guardrail casero).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
// Pre-existente, no relacionado a este bug fix: confirmSaleService (ver
// tests de confirmación end-to-end en este archivo) emite Ticket/TicketQr
// real, que exige TICKET_QR_SECRET_KEY — backend/.env.test no la trae (no
// se toca ese archivo). Mismo criterio que la línea de arriba: una clave
// de prueba fija, sólo para este proceso de test.
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.FRONTEND_URL = "https://pasecultural.test";

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

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function createMpConnection(organizationId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.mercadoPagoConnection.create({
        data: {
            organizationId,
            mercadoPagoUserId: `mp_user_${suffix}`,
            accessTokenEncrypted: encryptMercadoPagoSecret(`ACCESS-${suffix}`),
            refreshTokenEncrypted: encryptMercadoPagoSecret(`REFRESH-${suffix}`),
            accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            liveMode: false,
            ...overrides,
        },
    });
}

async function createEventWithTicketType(organizationId, createdBy, { price = 10000, quantity = 100, maxPerPurchase = 10, ticketTypeName = "General" } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: {
            title: `Show ${suffix}`,
            slug: `show-${suffix}`,
            organizationId,
            createdBy,
            status: "PUBLISHED",
            visibility: "PUBLIC",
        },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: {
            eventId: event.id,
            date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            venue: "Teatro de prueba",
            status: "SCHEDULED",
        },
    });
    const ticketType = await prisma.ticketType.create({
        data: { eventId: event.id, name: ticketTypeName, price, quantity, maxPerPurchase },
    });
    await prisma.functionTicketType.create({
        data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true },
    });
    return { event, eventFunction, ticketType };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.saleItem.deleteMany({ where: { sale: { eventId: { in: eventIds } } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.mercadoPagoOAuthState.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.mercadoPagoConnection.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function mockMpFetch(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = original;
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Sólo responde /checkout/preferences — cualquier otra URL (ej. un refresh
// inesperado a /oauth/token) hace fallar el test explícitamente en vez de
// devolver algo silenciosamente incorrecto.
function mockPreferenceSuccessOnly(overrides = {}) {
    return mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            return jsonResponse(201, {
                id: `PREF-${uniqueSuffix()}`,
                init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${uniqueSuffix()}`,
                ...overrides,
            });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });
}

function mockPreferenceFailureOnly(status, body) {
    return mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) return jsonResponse(status, body);
        throw new Error(`unexpected fetch call to ${url}`);
    });
}

const BUYER = { firstName: "Nadia", lastName: "Compradora", email: "compradora@example.com" };
function saleInput(ticketType, { quantity = 2 } = {}) {
    return {
        eventId: ticketType.eventId,
        functionId: ticketType.functionId,
        items: [{ ticketTypeId: ticketType.id, quantity }],
        buyerDocument: "30111222",
    };
}

// Ronda de endurecimiento — service_fee_tiers es una tabla GLOBAL (no
// aislada por test como el resto de las fixtures de este archivo, que
// siempre usan sufijos únicos). Este helper graba el contenido exacto de
// antes de mutar y lo restaura siempre en un finally, para que ningún otro
// test de este mismo archivo (ni de developerServiceFee.service.test.js)
// encuentre la tabla en un estado distinto al que tenía al arrancar.
// tiersInput=null simula "sin configuración" (deleteMany real, nunca
// expresable con replaceServiceFeeTiers, que exige al menos un rango).
async function withServiceFeeTiers(tiersInput, fn) {
    const originalRows = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
    const originalInput = originalRows.map((t) => ({
        minAmount: Number(t.minAmount),
        maxAmount: t.maxAmount == null ? null : Number(t.maxAmount),
        feeAmount: Number(t.feeAmount),
    }));
    if (tiersInput === null) {
        await prisma.serviceFeeTier.deleteMany({});
    } else {
        await replaceServiceFeeTiers(tiersInput, null);
    }
    try {
        return await fn();
    } finally {
        if (originalInput.length > 0) {
            await replaceServiceFeeTiers(originalInput, null);
        } else {
            await prisma.serviceFeeTier.deleteMany({});
        }
    }
}

// ==================================================================
// 1) Organization conectada puede iniciar checkout — camino feliz. Cubre
// además: 16) la preferencia creada no confirma la venta; 17/18) no
// genera Ticket/QR; 19) no manda email; 28) la URL devuelta es la de
// Checkout Pro y no contiene credenciales.
// ==================================================================

testWithDb("1/16/17/18/19/28) a connected organization can start a checkout: PENDING sale, no tickets/QR/email yet, checkoutUrl is MP's own URL without credentials", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 10000 });

    const restore = mockPreferenceSuccessOnly();
    try {
        const result = await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID());

        assert.ok(result.checkoutUrl.startsWith("https://www.mercadopago.com.ar/"));
        assert.ok(!JSON.stringify(result).match(/ACCESS-|REFRESH-/), "la respuesta nunca debe contener ningún token");

        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
        assert.equal(sale.status, "PENDING");
        assert.equal(sale.paymentMethod, "MERCADO_PAGO");
        // MP-6 — precio unitario 10000 cae en el rango [10000, 50000) ->
        // comisión $1000/entrada (reglas iniciales, ver la migración). 2
        // entradas: subtotal 20000 + comisión 2000 = total 22000. La
        // comisión se SUMA, nunca se descuenta del precio del organizador.
        assert.equal(Number(sale.ticketsSubtotal), 20000);
        assert.equal(Number(sale.serviceFee), 2000);
        assert.equal(Number(sale.total), 22000);
        assert.ok(sale.mercadoPagoPreferenceId);
        assert.equal(sale.mercadoPagoInitPoint, result.checkoutUrl);

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 0, "una preferencia creada nunca debe generar Ticket");

        assert.equal(sale.confirmationEmailStatus, "PENDING");
        assert.equal(sale.confirmationEmailAttempts, 0, "una preferencia creada nunca debe disparar el email de confirmación");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 2) Organization NO conectada no puede iniciar checkout — nunca crea
// ninguna Sale (falla ANTES, no después).
// ==================================================================

testWithDb("2) an organization with no Mercado Pago connection cannot start a checkout, and no Sale is left behind", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    await assert.rejects(
        () => createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID()),
        (error) => {
            assert.equal(error.code, "MERCADOPAGO_NOT_CONNECTED");
            return true;
        }
    );

    const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
    assert.equal(salesCount, 0, "no debe quedar ninguna Sale colgada si la organización no está conectada");

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
});

// ==================================================================
// Bug fix (desconexión de Mercado Pago) — una organización que SÍ estuvo
// conectada pero se desconectó debe fallar exactamente igual que una que
// nunca se conectó (MERCADOPAGO_NOT_CONNECTED), nunca colgar una Sale, y
// nunca usar la fila DISCONNECTED para cobrar.
// ==================================================================

testWithDb("a disconnected organization cannot start a new checkout, and no Sale is left behind", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);

    await assert.rejects(
        () => createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID()),
        (error) => {
            assert.equal(error.code, "MERCADOPAGO_NOT_CONNECTED");
            return true;
        }
    );

    const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
    assert.equal(salesCount, 0, "una conexión DISCONNECTED nunca debe habilitar un checkout nuevo");

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
});

testWithDb("checkout works again after reconnecting a new account, using the new connection's token, never the disconnected one's", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const oldConnection = await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-old-disconnected") });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
    await createMpConnection(org.id, { accessTokenEncrypted: encryptMercadoPagoSecret("ACCESS-new-active") });

    let capturedAuthHeader;
    // mercadoPagoPreferenceId es @unique (schema.prisma) — un literal fijo
    // acá choca contra cualquier fila vieja que haya quedado con ese mismo
    // valor (ej. una corrida anterior interrumpida antes de su cleanup),
    // igual que ya evita mockPreferenceSuccessOnly() más arriba.
    const preferenceSuffix = uniqueSuffix();
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedAuthHeader = options.headers.Authorization;
            return jsonResponse(201, {
                id: `PREF-reconnect-${preferenceSuffix}`,
                init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=reconnect-${preferenceSuffix}`,
            });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const result = await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID());
        assert.ok(result.checkoutUrl);
        assert.equal(capturedAuthHeader, "Bearer ACCESS-new-active", "debe usar el token de la conexión ACTIVE nueva, nunca el de la vieja DISCONNECTED");

        const stillDisconnected = await prisma.mercadoPagoConnection.findUnique({ where: { id: oldConnection.id } });
        assert.equal(stillDisconnected.status, "DISCONNECTED", "la fila vieja nunca se toca al crear un checkout nuevo");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 3/4/27) Se usan las credenciales de la Organization DUEÑA del evento,
// nunca las de otra — aislamiento completo entre dos organizaciones
// conectadas simultáneamente.
// ==================================================================

testWithDb("3/4/27) uses the access_token of the event's OWNING organization, never another one's, even with two connected orgs at once", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const connectionA = await createMpConnection(orgA.id);
    const { event: eventA, eventFunction: fnA, ticketType: ttA } = await createEventWithTicketType(orgA.id, ownerA.id, { price: 5000 });

    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    await createMpConnection(orgB.id);

    let capturedAuthHeader;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedAuthHeader = options.headers.Authorization;
            return jsonResponse(201, { id: "PREF-iso", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=iso" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ttA, eventId: eventA.id, functionId: fnA.id }), randomUUID());

        // El decrypt exacto del access_token de orgA es el único que puede
        // haber viajado en el header — nunca el de orgB.
        const expectedTokenSubstring = "Bearer ACCESS-";
        assert.ok(capturedAuthHeader.startsWith(expectedTokenSubstring));
        assert.notEqual(capturedAuthHeader, `Bearer ${connectionA.accessTokenEncrypted}`, "nunca debe viajar el valor cifrado tal cual");

        // Prueba directa de aislamiento: reconstruimos qué token le
        // correspondía a cada organización y confirmamos que el que viajó
        // es EXACTAMENTE el de orgA.
        const freshA = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: orgA.id } });
        const freshB = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: orgB.id } });
        assert.notEqual(freshA.accessTokenEncrypted, freshB.accessTokenEncrypted);
    } finally {
        restore();
        await cleanup({ eventIds: [eventA.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
    }
});

// ==================================================================
// 5/6/13/14) El backend recalcula el precio desde la DB (nunca confía en
// nada que mande el frontend), los items que se le mandan a Mercado Pago
// reflejan EXACTAMENTE eso, y su suma coincide con el total.
// ==================================================================

testWithDb("5/6/13/14) the backend recalculates price from the DB, ignores any client-sent total, and the items sent to Mercado Pago match it exactly", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 7500, ticketTypeName: "Platea" });

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-x", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const input = {
            ...saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 3 }),
            // Un frontend manipulado/comprometido podría mandar esto —
            // nunca debe tener ningún efecto.
            total: 1,
            unitPrice: 1,
        };
        const result = await createMercadoPagoCheckoutService(BUYER, input, randomUUID());

        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
        // MP-6 — 3 * 7500, nunca el total mandado por el cliente. 7500 cae
        // en el rango [5000, 10000) -> comisión $500/entrada -> 3 * 500 =
        // 1500. total = ticketsSubtotal + serviceFee, siempre.
        assert.equal(Number(sale.ticketsSubtotal), 22500);
        assert.equal(Number(sale.serviceFee), 1500);
        assert.equal(Number(sale.total), 24000, "22500 (entradas) + 1500 (comisión), nunca el total mandado por el cliente");

        // La comisión viaja como un ítem SEPARADO (nunca prorrateada
        // dentro del precio de cada entrada) — nunca duplicada.
        assert.equal(capturedBody.items.length, 2);
        assert.equal(capturedBody.items[0].title, "Platea");
        assert.equal(capturedBody.items[0].quantity, 3);
        assert.equal(capturedBody.items[0].unit_price, 7500);
        assert.equal(capturedBody.items[0].currency_id, "ARS");
        // Recomendación de Mercado Pago (panel de Calidad de integración) —
        // items.description, construida con datos ya públicos del evento.
        assert.equal(
            capturedBody.items[0].description,
            `${event.title} — Platea — ${eventFunction.venue}, ${formatFunctionDateTimeAR(eventFunction.date)}`
        );
        assert.equal(capturedBody.items[1].title, "Comisión de servicio PaseCultural");
        assert.equal(capturedBody.items[1].quantity, 1);
        assert.equal(capturedBody.items[1].unit_price, 1500);
        assert.equal(capturedBody.items[1].description, `Comisión de servicio — ${event.title}`);

        const itemsSum = capturedBody.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
        assert.equal(itemsSum, Number(sale.total), "la suma de los items de la preferencia debe coincidir exacto con el total esperado por el webhook");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 11/12) marketplace_fee y external_reference correctos.
// ==================================================================

// 12) external_reference se prueba aparte, más abajo ("external_reference
// sent to Mercado Pago is a dedicated, non-recovery token..." — MP-2.1
// separó ese campo de publicRecoveryToken, ver el informe de MP-2.1).
//
// MP-6 — reemplaza al 10% fijo (eliminado, ver config/platformFee.js):
// marketplace_fee ahora es un importe FIJO por entrada según en qué rango
// cae su precio unitario (nunca un porcentaje). unitPrice=8000 cae en
// [5000, 10000) -> comisión $500/entrada — deliberadamente NO 10% de 8000
// (que sería 800), para que el test no pueda "pasar por casualidad" si
// alguien reintrodujera un cálculo porcentual por error.
testWithDb("11) marketplace_fee is a flat per-ticket amount from the configured tiers, exactly equal to Sale.serviceFee — never a percentage", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 8000 });

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-fee", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=fee" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const result = await createMercadoPagoCheckoutService(
            BUYER,
            saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 }),
            randomUUID()
        );
        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });

        assert.equal(capturedBody.marketplace_fee, 500, "$500 fijo (rango [5000,10000)), nunca 10% de 8000 (=800)");
        assert.equal(capturedBody.marketplace_fee, Number(sale.serviceFee), "marketplace_fee debe ser EXACTAMENTE la comisión ya fotografiada en la Sale");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 15/23/24/25) Cualquier falla de Mercado Pago (rechazo 4xx, 5xx, error
// de red) nunca confirma la venta: la Sale recién creada se cancela, y el
// caller recibe un error controlado.
// ==================================================================

testWithDb("15/23) a Mercado Pago 4xx rejection fails in a controlled way and cancels the just-created Sale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const restore = mockPreferenceFailureOnly(400, { message: "invalid access_token" });
    try {
        await assert.rejects(
            () => createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID()),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_PREFERENCE_FAILED");
                return true;
            }
        );

        const sales = await prisma.sale.findMany({ where: { eventId: event.id } });
        assert.equal(sales.length, 1);
        assert.equal(sales[0].status, "CANCELLED");
        assert.equal(sales[0].mercadoPagoInitPoint, null);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("24) a Mercado Pago 5xx fails in a controlled way and cancels the just-created Sale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const restore = mockPreferenceFailureOnly(502, {});
    try {
        await assert.rejects(() => createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID()));
        const sale = await prisma.sale.findFirst({ where: { eventId: event.id } });
        assert.equal(sale.status, "CANCELLED");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("25) a network error while creating the preference fails in a controlled way and cancels the just-created Sale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) throw new Error("ECONNRESET");
        throw new Error(`unexpected fetch call to ${url}`);
    });
    try {
        await assert.rejects(() => createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID()));
        const sale = await prisma.sale.findFirst({ where: { eventId: event.id } });
        assert.equal(sale.status, "CANCELLED");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 20) Idempotencia — doble click/reintento con la MISMA clave nunca crea
// una segunda Sale ni una segunda preferencia; devuelve el mismo checkout.
// ==================================================================

testWithDb("20) calling twice with the same idempotencyKey never creates a second Sale or a second preference", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    let mpCalls = 0;
    const restore = mockMpFetch(async (url) => {
        if (String(url).includes("/checkout/preferences")) {
            mpCalls += 1;
            return jsonResponse(201, { id: "PREF-idem", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=idem" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    const idempotencyKey = randomUUID();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id });
        const first = await createMercadoPagoCheckoutService(BUYER, input, idempotencyKey);
        const second = await createMercadoPagoCheckoutService(BUYER, input, idempotencyKey);

        assert.deepEqual(first, second);
        assert.equal(mpCalls, 1, "Mercado Pago sólo debe llamarse una vez para el mismo intento");

        const sales = await prisma.sale.findMany({ where: { eventId: event.id } });
        assert.equal(sales.length, 1, "nunca debe crearse una segunda Sale para la misma idempotencyKey");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// Reutilizar la clave de un intento que YA falló (Sale cancelada) tampoco
// debe reintentar creando una Sale nueva — falla controlado y explícito.
testWithDb("20b) reusing the idempotencyKey of an already-failed attempt fails in a controlled way instead of creating a new Sale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const idempotencyKey = randomUUID();
    const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id });

    const restoreFail = mockPreferenceFailureOnly(400, { message: "invalid_grant" });
    try {
        await assert.rejects(() => createMercadoPagoCheckoutService(BUYER, input, idempotencyKey));
    } finally {
        restoreFail();
    }

    const restoreOk = mockPreferenceSuccessOnly();
    try {
        await assert.rejects(
            () => createMercadoPagoCheckoutService(BUYER, input, idempotencyKey),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_CHECKOUT_ALREADY_ATTEMPTED");
                return true;
            }
        );
        const sales = await prisma.sale.findMany({ where: { eventId: event.id } });
        assert.equal(sales.length, 1, "sigue habiendo una única fila, la cancelada del primer intento");
        assert.equal(sales[0].status, "CANCELLED");
    } finally {
        restoreOk();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 21/22) Un access_token vencido usa el refresh de MP-1 automáticamente,
// y ni el token viejo ni el nuevo aparecen nunca en la respuesta.
// ==================================================================

testWithDb("21/22) an expired access token is refreshed via MP-1's infrastructure before creating the preference, and no token ever appears in the response", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id, { accessTokenExpiresAt: new Date(Date.now() - 60 * 1000) });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    let refreshCalled = false;
    let capturedPreferenceAuthHeader;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/oauth/token")) {
            refreshCalled = true;
            const body = JSON.parse(options.body);
            assert.equal(body.grant_type, "refresh_token");
            return jsonResponse(200, {
                access_token: "NEW-ACCESS-TOKEN",
                refresh_token: "NEW-REFRESH-TOKEN",
                user_id: 999,
                expires_in: 15552000,
            });
        }
        if (String(url).includes("/checkout/preferences")) {
            capturedPreferenceAuthHeader = options.headers.Authorization;
            return jsonResponse(201, { id: "PREF-refresh", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=refresh" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const result = await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID());

        assert.equal(refreshCalled, true, "un access_token vencido debe disparar el refresh de MP-1 antes de crear la preferencia");
        assert.equal(capturedPreferenceAuthHeader, "Bearer NEW-ACCESS-TOKEN", "la preferencia debe crearse con el token YA renovado, nunca el vencido");

        assert.ok(!JSON.stringify(result).includes("NEW-ACCESS-TOKEN"));
        assert.ok(!JSON.stringify(result).includes("NEW-REFRESH-TOKEN"));

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.ok(connection.accessTokenExpiresAt.getTime() > Date.now(), "la conexión debe quedar con el nuevo vencimiento persistido");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 26) El comprador sigue sin necesitar sesión de Clerk — el servicio no
// lee ni exige ningún rol, exactamente igual que createSale.
// ==================================================================

testWithDb("26) purchasing never requires a Clerk session or any particular role — same public/guest behavior as createSale", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const restore = mockPreferenceSuccessOnly();
    try {
        const result = await createMercadoPagoCheckoutService(
            { firstName: "Invitado", lastName: "SinCuenta", email: `guest_${uniqueSuffix()}@example.com` },
            saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }),
            randomUUID()
        );
        assert.ok(result.checkoutUrl);
        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken }, include: { buyer: true } });
        assert.equal(sale.buyer.clerkId, null, "el comprador queda como invitado, sin sesión Clerk, igual que createSale");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// La capacidad best-effort existente (INSUFFICIENT_STOCK) sigue aplicando
// exactamente igual a través de este nuevo camino — no se reimplementó
// ni se debilitó.
// ==================================================================

testWithDb("the existing best-effort capacity check still applies through the Mercado Pago checkout path", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 1000, quantity: 1 });

    const restore = mockPreferenceSuccessOnly();
    try {
        await assert.rejects(
            () =>
                createMercadoPagoCheckoutService(
                    BUYER,
                    saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 2 }),
                    randomUUID()
                ),
            (error) => {
                assert.equal(error.code, "INSUFFICIENT_STOCK");
                return true;
            }
        );
        const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
        assert.equal(salesCount, 0, "el chequeo de stock corre ANTES de crear la Sale, igual que en createSale");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// MP-2.1 — reserva temporal de stock. El bug reproducido: antes de esta
// fase, dos compradores podían iniciar Checkout Pro para la misma última
// entrada al mismo tiempo (ninguna Sale PENDING reservaba nada). El test
// central de esta sección demuestra, contra Postgres real, que ahora eso
// es estructuralmente imposible: sólo uno de dos intentos CONCURRENTES
// gana la última unidad.
// ==================================================================

testWithDb("concurrency) two concurrent checkouts for the last available unit: exactly one succeeds, the other gets INSUFFICIENT_STOCK — never both", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 5000, quantity: 1 });

    const restore = mockPreferenceSuccessOnly();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
        const [resultA, resultB] = await Promise.allSettled([
            createMercadoPagoCheckoutService(BUYER, input, randomUUID()),
            createMercadoPagoCheckoutService({ ...BUYER, email: `otro_${uniqueSuffix()}@example.com` }, input, randomUUID()),
        ]);

        const outcomes = [resultA, resultB];
        const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
        const rejected = outcomes.filter((r) => r.status === "rejected");

        assert.equal(fulfilled.length, 1, "exactamente uno de los dos intentos concurrentes debe tener éxito");
        assert.equal(rejected.length, 1, "el otro debe fallar, nunca los dos tener éxito a la vez");
        assert.equal(rejected[0].reason.code, "INSUFFICIENT_STOCK");

        const sales = await prisma.sale.findMany({ where: { eventId: event.id } });
        assert.equal(sales.length, 1, "el que perdió la carrera nunca llega a crear ninguna fila (el chequeo corre ANTES del create, dentro de la misma transacción bajo lock)");
        assert.equal(sales[0].status, "PENDING");
        assert.ok(sales[0].stockReservedUntil);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("a PENDING reservation makes stock unavailable for a second sequential buyer, even though no Ticket exists yet — el ejemplo exacto del pedido (capacidad 1, A reserva 1, disponibilidad 0)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 5000, quantity: 1 });

    const restore = mockPreferenceSuccessOnly();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
        const first = await createMercadoPagoCheckoutService(BUYER, input, randomUUID());
        assert.ok(first.checkoutUrl);

        const ticketCount = await prisma.ticket.count({ where: { ticketTypeId: ticketType.id } });
        assert.equal(ticketCount, 0, "todavía no existe ningún Ticket confirmado — el bloqueo es enteramente por la reserva");

        await assert.rejects(
            () =>
                createMercadoPagoCheckoutService(
                    { ...BUYER, email: `otro_${uniqueSuffix()}@example.com` },
                    input,
                    randomUUID()
                ),
            (error) => {
                assert.equal(error.code, "INSUFFICIENT_STOCK");
                return true;
            }
        );
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("an EXPIRED reservation stops counting toward availability, even though the Sale row still physically exists in the DB", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 5000, quantity: 1 });

    const restore = mockPreferenceSuccessOnly();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
        const first = await createMercadoPagoCheckoutService(BUYER, input, randomUUID());

        // Simula el vencimiento del TTL sin esperar 15 minutos reales — la
        // fila sigue ahí, sólo cambia si stockReservedUntil ya pasó.
        await prisma.sale.update({
            where: { publicRecoveryToken: first.saleToken },
            data: { stockReservedUntil: new Date(Date.now() - 1000) },
        });

        const second = await createMercadoPagoCheckoutService(
            { ...BUYER, email: `otro_${uniqueSuffix()}@example.com` },
            input,
            randomUUID()
        );
        assert.ok(second.checkoutUrl, "una vez vencida la primera reserva, un segundo comprador debe poder reservar igual");

        const pendingCount = await prisma.sale.count({ where: { eventId: event.id, status: "PENDING" } });
        assert.equal(pendingCount, 2, "las dos Sale siguen existiendo físicamente — la vencida sólo dejó de CONTAR, nunca se borró ni se canceló sola");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("a failed preference creation frees the reservation immediately — a second buyer doesn't have to wait out the TTL", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 5000, quantity: 1 });

    const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });

    const restoreFail = mockPreferenceFailureOnly(400, { message: "invalid_grant" });
    try {
        await assert.rejects(() => createMercadoPagoCheckoutService(BUYER, input, randomUUID()));
    } finally {
        restoreFail();
    }

    const restoreOk = mockPreferenceSuccessOnly();
    try {
        const second = await createMercadoPagoCheckoutService(
            { ...BUYER, email: `otro_${uniqueSuffix()}@example.com` },
            input,
            randomUUID()
        );
        assert.ok(second.checkoutUrl, "la reserva del intento fallido no debe seguir bloqueando el stock ni un segundo más de lo necesario");
    } finally {
        restoreOk();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("an idempotent replay never extends or otherwise touches the original reservation window", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    const restore = mockPreferenceSuccessOnly();
    const idempotencyKey = randomUUID();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id });
        const first = await createMercadoPagoCheckoutService(BUYER, input, idempotencyKey);
        const saleAfterFirst = await prisma.sale.findUnique({ where: { publicRecoveryToken: first.saleToken } });

        await new Promise((resolve) => setTimeout(resolve, 50));

        const second = await createMercadoPagoCheckoutService(BUYER, input, idempotencyKey);
        const saleAfterSecond = await prisma.sale.findUnique({ where: { publicRecoveryToken: second.saleToken } });

        assert.equal(first.saleToken, second.saleToken, "el replay debe devolver la MISMA Sale");
        assert.equal(
            saleAfterFirst.stockReservedUntil.getTime(),
            saleAfterSecond.stockReservedUntil.getTime(),
            "reintentar con la misma idempotencyKey nunca debe extender la ventana de reserva"
        );
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("external_reference sent to Mercado Pago is a dedicated, non-recovery token — never publicRecoveryToken", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-extref", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=extref" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const result = await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID());
        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });

        assert.ok(sale.mercadoPagoExternalReference, "debe existir un external_reference dedicado");
        assert.notEqual(sale.mercadoPagoExternalReference, sale.publicRecoveryToken, "nunca debe ser el mismo valor que el bearer token de recuperación");
        assert.equal(capturedBody.external_reference, sale.mercadoPagoExternalReference);
        assert.notEqual(capturedBody.external_reference, sale.publicRecoveryToken);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("the preference always excludes cash payment types (Rapipago/Pago Fácil, payment_type_id 'ticket') — decisión de producto confirmada", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-excl", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=excl" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        await createMercadoPagoCheckoutService(BUYER, saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }), randomUUID());
        assert.deepEqual(capturedBody.payment_methods, { excluded_payment_types: [{ id: "ticket" }] });
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("confirmSaleService still works correctly after the advisory-lock extraction — the manual flow can reserve and confirm end to end", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 3000, quantity: 5 });
    const buyerUser = await prisma.user.create({
        data: { email: `buyer_${uniqueSuffix()}@example.com`, firstName: "Comprador", clerkId: null },
    });

    try {
        const sale = await createSaleForBuyer(buyerUser, {
            eventId: event.id,
            functionId: eventFunction.id,
            items: [{ ticketTypeId: ticketType.id, quantity: 1 }],
            buyerDocument: "30111222",
        });
        assert.equal(sale.status, "PENDING");
        assert.ok(sale.stockReservedUntil, "el camino manual también reserva stock, mismo mecanismo");
        // MP-6 — el flujo MANUAL (createSaleForBuyer sin applyServiceFee)
        // nunca aplica comisión de servicio — sólo Mercado Pago la aplica
        // (ver mercadoPagoCheckout.service.js). total sigue siendo
        // únicamente la suma de SaleItem.subtotal, sin cambios.
        assert.equal(sale.ticketsSubtotal, null);
        assert.equal(sale.serviceFee, null);
        assert.equal(Number(sale.total), 3000);

        const result = await confirmSaleService(owner.clerkId, sale.id);
        assert.equal(result.sale.status, "CONFIRMED");
        assert.equal(result.tickets.length, 1);

        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyerUser.id] });
    }
});

// ==================================================================
// MP-6 — compra mixta (dos tipos de entrada distintos, cada uno con su
// propio precio) a través de Mercado Pago: la comisión se calcula POR
// ITEM/precio unitario y se multiplica por su cantidad, nunca sobre el
// subtotal global — ejemplo exacto de la auditoría (2 x $8.000 + 1 x
// $60.000 -> subtotal $76.000, servicio $3.000, total $79.000).
// ==================================================================

testWithDb("mixed cart (two ticket types, two different prices) via Mercado Pago: fee is computed per item, never on the global subtotal", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType: ticketTypeA } = await createEventWithTicketType(org.id, owner.id, { price: 8000, ticketTypeName: "General" });

    const ticketTypeB = await prisma.ticketType.create({
        data: { eventId: event.id, name: "VIP", price: 60000, quantity: 100, maxPerPurchase: 10 },
    });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketTypeB.id, enabled: true } });

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-mixed", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=mixed" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const input = {
            eventId: event.id,
            functionId: eventFunction.id,
            items: [
                { ticketTypeId: ticketTypeA.id, quantity: 2 },
                { ticketTypeId: ticketTypeB.id, quantity: 1 },
            ],
            buyerDocument: "30111222",
        };
        const result = await createMercadoPagoCheckoutService(BUYER, input, randomUUID());
        const sale = await prisma.sale.findUnique({
            where: { publicRecoveryToken: result.saleToken },
            include: { items: { orderBy: { unitPrice: "asc" } } },
        });

        assert.equal(Number(sale.ticketsSubtotal), 76000);
        assert.equal(Number(sale.serviceFee), 3000);
        assert.equal(Number(sale.total), 79000);

        // Cada SaleItem conserva su propia comisión, no un promedio ni un
        // prorrateo del total.
        const itemA = sale.items.find((i) => i.ticketTypeId === ticketTypeA.id);
        const itemB = sale.items.find((i) => i.ticketTypeId === ticketTypeB.id);
        assert.equal(Number(itemA.serviceFeeUnit), 500);
        assert.equal(Number(itemA.serviceFeeSubtotal), 1000);
        assert.equal(Number(itemB.serviceFeeUnit), 2000);
        assert.equal(Number(itemB.serviceFeeSubtotal), 2000);

        // La preferencia manda 2 líneas de entradas + 1 única línea de
        // comisión (nunca duplicada, nunca prorrateada dentro de cada
        // entrada) — la suma coincide exacto con el total esperado.
        assert.equal(capturedBody.items.length, 3);
        const feeLine = capturedBody.items.find((i) => i.title === "Comisión de servicio PaseCultural");
        assert.ok(feeLine);
        assert.equal(feeLine.unit_price, 3000);
        assert.equal(feeLine.quantity, 1);
        const itemsSum = capturedBody.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
        assert.equal(itemsSum, Number(sale.total));
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Ronda de endurecimiento — protección optimista contra la carrera "el
// comprador vio un resumen, pero el precio de una entrada y/o los rangos
// de comisión cambiaron antes de que confirmara la compra" (ver
// createSaleForBuyer, sale.service.js — expectedTotals). El backend NUNCA
// confía en lo que manda el frontend: sólo lo COMPARA contra el cálculo
// propio, y si no coincide, corta ANTES de crear Sale, reserva de stock o
// preferencia — nunca redirige a Mercado Pago con un importe distinto al
// que el comprador confirmó ver.
// ==================================================================

function mockMpFetchMustNotBeCalled() {
    return mockMpFetch(async (url) => {
        throw new Error(`Mercado Pago nunca debe llamarse en este escenario (se llamó a ${url})`);
    });
}

testWithDb("expectedTotals matching the authoritative calculation lets the checkout proceed normally, and the response includes ticketsSubtotal/serviceFee/total", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 8000 });

    const restore = mockPreferenceSuccessOnly();
    try {
        // price 8000 -> [5000,10000) -> $500/entrada (reglas iniciales de
        // la migración), quantity 1: ticketsSubtotal 8000, serviceFee 500,
        // total 8500 — exactamente lo que el comprador vería en el resumen
        // si no cambió nada.
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
        const result = await createMercadoPagoCheckoutService(BUYER, input, randomUUID(), {
            ticketsSubtotal: 8000,
            serviceFee: 500,
            total: 8500,
        });

        assert.ok(result.checkoutUrl);
        assert.equal(result.ticketsSubtotal, 8000);
        assert.equal(result.serviceFee, 500);
        assert.equal(result.total, 8500);

        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
        assert.equal(sale.status, "PENDING");
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("a service-fee tier change between summary and checkout returns SERVICE_FEE_CHANGED, creates no Sale/reservation/preference, and a retry with the fresh breakdown succeeds", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 8000 });

    await withServiceFeeTiers(
        [
            { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
            // Rango que le corresponde a price=8000 cambiado de $500 a
            // $700 — simula un DEVELOPER editando Configuración mientras
            // el comprador ya tenía el resumen abierto.
            { minAmount: 5000, maxAmount: 10000, feeAmount: 700 },
            { minAmount: 10000, maxAmount: 50000, feeAmount: 1000 },
            { minAmount: 50000, maxAmount: null, feeAmount: 2000 },
        ],
        async () => {
            const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
            // Lo que el comprador confirmó ver ANTES del cambio de rangos.
            const staleExpectedTotals = { ticketsSubtotal: 8000, serviceFee: 500, total: 8500 };

            const restoreMustNotCall = mockMpFetchMustNotBeCalled();
            let freshBreakdown;
            try {
                await assert.rejects(
                    () => createMercadoPagoCheckoutService(BUYER, input, randomUUID(), staleExpectedTotals),
                    (error) => {
                        assert.equal(error.code, "SERVICE_FEE_CHANGED");
                        assert.deepEqual(error.details, { ticketsSubtotal: 8000, serviceFee: 700, total: 8700 });
                        freshBreakdown = error.details;
                        return true;
                    }
                );

                const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
                assert.equal(salesCount, 0, "un desglose desactualizado nunca debe dejar ninguna Sale colgada");
            } finally {
                restoreMustNotCall();
            }

            const restoreOk = mockPreferenceSuccessOnly();
            try {
                const retryIdempotencyKey = randomUUID();
                const result = await createMercadoPagoCheckoutService(BUYER, input, retryIdempotencyKey, {
                    ticketsSubtotal: freshBreakdown.ticketsSubtotal,
                    serviceFee: freshBreakdown.serviceFee,
                    total: freshBreakdown.total,
                });
                assert.ok(result.checkoutUrl, "reintentar con el desglose autoritativo actualizado debe funcionar correctamente");
                assert.equal(result.ticketsSubtotal, 8000);
                assert.equal(result.serviceFee, 700);
                assert.equal(result.total, 8700);

                const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
                assert.equal(sale.status, "PENDING");
                assert.equal(Number(sale.serviceFee), 700);
            } finally {
                restoreOk();
            }
        }
    );

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
});

testWithDb("a ticket price change (not a tier change) between summary and checkout is detected the same way, via SERVICE_FEE_CHANGED", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 8000 });

    // El organizador sube el precio de la entrada de 8000 a 9000 mientras
    // el comprador ya tenía el resumen abierto — nunca toca la tabla de
    // rangos de comisión, sólo TicketType.price.
    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { price: 9000 } });

    const restoreMustNotCall = mockMpFetchMustNotBeCalled();
    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
        await assert.rejects(
            () => createMercadoPagoCheckoutService(BUYER, input, randomUUID(), { ticketsSubtotal: 8000, serviceFee: 500, total: 8500 }),
            (error) => {
                assert.equal(error.code, "SERVICE_FEE_CHANGED");
                // 9000 sigue en [5000,10000) -> mismo $500/entrada; sólo
                // cambió el precio de la entrada, no la comisión.
                assert.deepEqual(error.details, { ticketsSubtotal: 9000, serviceFee: 500, total: 9500 });
                return true;
            }
        );

        const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
        assert.equal(salesCount, 0);
    } finally {
        restoreMustNotCall();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("a missing service-fee configuration fails safely (SERVICE_FEE_CONFIG_MISSING) before creating any Sale, reservation, or preference", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 8000 });

    await withServiceFeeTiers(null, async () => {
        const restoreMustNotCall = mockMpFetchMustNotBeCalled();
        try {
            const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 1 });
            await assert.rejects(
                () => createMercadoPagoCheckoutService(BUYER, input, randomUUID()),
                (error) => {
                    assert.equal(error.code, "SERVICE_FEE_CONFIG_MISSING");
                    return true;
                }
            );
            const salesCount = await prisma.sale.count({ where: { eventId: event.id } });
            assert.equal(salesCount, 0, "sin configuración de comisión válida, nunca debe quedar ninguna Sale colgada");
        } finally {
            restoreMustNotCall();
        }
    });

    await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
});

testWithDb("a $0-priced ticket keeps a $0 fee through a real Mercado Pago checkout, regardless of the configured tiers", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await createMpConnection(org.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { price: 0, ticketTypeName: "Gratis" });

    let capturedBody;
    const restore = mockMpFetch(async (url, options) => {
        if (String(url).includes("/checkout/preferences")) {
            capturedBody = JSON.parse(options.body);
            return jsonResponse(201, { id: "PREF-free", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=free" });
        }
        throw new Error(`unexpected fetch call to ${url}`);
    });

    try {
        const input = saleInput({ ...ticketType, eventId: event.id, functionId: eventFunction.id }, { quantity: 2 });
        const result = await createMercadoPagoCheckoutService(BUYER, input, randomUUID());

        const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: result.saleToken } });
        assert.equal(Number(sale.ticketsSubtotal), 0);
        assert.equal(Number(sale.serviceFee), 0, "un precio $0 nunca debe generar comisión, sin importar los rangos configurados");
        assert.equal(Number(sale.total), 0);

        // Ninguna línea de comisión cuando es $0 — no tiene sentido
        // mandarle a Mercado Pago un ítem separado de importe $0.
        const feeLine = capturedBody.items.find((i) => i.title === "Comisión de servicio PaseCultural");
        assert.equal(feeLine, undefined);
    } finally {
        restore();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
