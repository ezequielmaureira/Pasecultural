import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import {
    getOrganizerNotificationSettingsService,
    replaceOrganizerNotificationSettingsService,
    getOrganizerNotificationSettingsOrDefaults,
    tryClaimOrganizerNotification,
} from "../src/services/organizerNotificationSettings.service.js";
import { disconnectMercadoPagoConnectionService } from "../src/services/mercadoPagoConnection.service.js";
import { createWithdrawalRequestService } from "../src/services/withdrawalRequest.service.js";
import { requestWithdrawalRequestOtpService } from "../src/services/withdrawalRequestVerification.service.js";

// Notificaciones Organizer — CRUD real + hooks (venta confirmada, hito de
// ventas, stock bajo/agotado, WithdrawalRequest, MP desconectado) contra
// Postgres real (backend/.env.test), mismo criterio que
// withdrawalRequest.crud.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía (el usuario pidió explícitamente no correr test:db
// esta ronda) — queda escrito y registrado en dbTestFiles.js para la
// próxima corrida autorizada. Cobertura: settings CRUD + aislamiento,
// venta confirmada ON/OFF + no duplicado en un replay, hito de ventas +
// dedup, stock bajo, agotado (obligatoria), WithdrawalRequest (regresión
// del email generalizado), MP desconectado (obligatoria, idempotente). NO
// cubierto acá (ver el informe de entrega para el detalle): recordatorio/
// inicio/fin de evento (necesitan el sweep, no un hook síncrono — más
// apropiado para un test dedicado del script), actividad de Scanner
// (requiere una sesión de scanner completa), y MP_REAUTH_NEEDED (requiere
// mockear la respuesta HTTP de renovación de OAuth de Mercado Pago, fuera
// de alcance de esta ronda).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// Mismo mecanismo EXACTO que mockResendFetchSuccessOnly/withMockedResendEnv
// en withdrawalRequest.crud.test.js (monkeypatchear globalThis.fetch,
// restaurar al terminar) — ver ese archivo para el razonamiento completo
// (incluye por qué FRONTEND_URL también hace falta).
function mockResendFetchSuccessOnly() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url} during a Resend-mocked test`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

function withMockedResendEnv() {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalEmailFrom = process.env.EMAIL_FROM;
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.RESEND_API_KEY = "test-mocked-resend-api-key";
    process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
    process.env.FRONTEND_URL = "https://pasecultural.test";
    return () => {
        if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = originalApiKey;
        if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = originalEmailFrom;
        if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = originalFrontendUrl;
    };
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, phone: "+54 9 351 412-3456", ...overrides },
    });
}

async function createEventWithTicketType(organizationId, createdBy, { price = 5000, quantity = 50 } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price, quantity, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

async function buySale({ event, eventFunction, ticketType, organizerClerkId, quantity = 1, skipAutoEmail = true }) {
    const suffix = uniqueSuffix();
    const buyerUser = await prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", clerkId: null } });
    const sale = await createSaleForBuyer(buyerUser, {
        eventId: event.id,
        functionId: eventFunction.id,
        items: [{ ticketTypeId: ticketType.id, quantity }],
        buyerDocument: "30111222",
    });
    await confirmSaleService(organizerClerkId, sale.id, { skipAutoEmail });
    return { sale: await prisma.sale.findUnique({ where: { id: sale.id } }), buyerUser };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [], mercadoPagoConnectionIds = [] }) {
    await prisma.organizerNotificationClaim.deleteMany({ where: { OR: eventIds.length ? [{ key: { contains: eventIds[0] } }] : [] } });
    await prisma.withdrawalRequest.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.mercadoPagoConnection.deleteMany({ where: { id: { in: mercadoPagoConnectionIds } } });
    await prisma.ticketQr.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    const sales = await prisma.sale.findMany({ where: { eventId: { in: eventIds } }, select: { buyerId: true } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organizerNotificationSettings.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    const buyerIds = sales.map((s) => s.buyerId);
    await prisma.user.deleteMany({ where: { id: { in: [...userIds, ...buyerIds] } } });
}

// --- Settings CRUD + aislamiento ---

testWithDb("an organization with no saved settings gets all-off defaults, never throws", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const settings = await getOrganizerNotificationSettingsOrDefaults(org.id);
        assert.equal(settings.saleConfirmedEnabled, false);
        assert.equal(settings.salesMilestoneEnabled, false);
        assert.equal(settings.lowStockEnabled, false);
        assert.equal(settings.eventReminderEnabled, false);
        assert.equal(settings.scannerActivityEnabled, false);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("an organizer can save and read back their own settings via the real service", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const saved = await replaceOrganizerNotificationSettingsService(owner.clerkId, {
            saleConfirmedEnabled: true,
            salesMilestoneEnabled: true,
            salesMilestoneCount: 50,
            lowStockEnabled: true,
            lowStockPercent: 15,
            eventReminderEnabled: false,
            eventReminderHoursBefore: 24,
            eventStartEnabled: false,
            eventEndEnabled: false,
            scannerActivityEnabled: false,
        });
        assert.equal(saved.saleConfirmedEnabled, true);
        assert.equal(saved.salesMilestoneCount, 50);

        const read = await getOrganizerNotificationSettingsService(owner.clerkId);
        assert.equal(read.lowStockPercent, 15);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("an organizer can never read or modify another organization's settings (IDOR/BOLA)", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    try {
        await replaceOrganizerNotificationSettingsService(ownerB.clerkId, {
            saleConfirmedEnabled: true, salesMilestoneEnabled: false, salesMilestoneCount: 100,
            lowStockEnabled: false, lowStockPercent: 20, eventReminderEnabled: false,
            eventReminderHoursBefore: 24, eventStartEnabled: false, eventEndEnabled: false, scannerActivityEnabled: false,
        });

        // No hay ningún parámetro de organizationId en la firma del
        // service — se resuelve EXCLUSIVAMENTE por ownerId del clerkId
        // autenticado, así que no hay forma de que ownerA "pida" ver la de
        // orgB ni siquiera intentándolo: sólo puede ver/tocar la SUYA.
        const readByA = await getOrganizerNotificationSettingsService(ownerA.clerkId);
        assert.equal(readByA.saleConfirmedEnabled, false, "A debe ver sus propios defaults, nunca los valores que B guardó");
    } finally {
        await cleanup({ organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
    }
});

testWithDb("tryClaimOrganizerNotification: only one of two concurrent claims for the same key succeeds, and it never re-claims", async () => {
    const key = `test-claim:${uniqueSuffix()}`;
    try {
        const [a, b] = await Promise.all([tryClaimOrganizerNotification(key), tryClaimOrganizerNotification(key)]);
        assert.equal([a, b].filter(Boolean).length, 1, "exactamente uno de los dos claims concurrentes debe ganar");
        const third = await tryClaimOrganizerNotification(key);
        assert.equal(third, false, "un key ya reclamado nunca vuelve a reclamarse, ni sin cooldown");
    } finally {
        await prisma.organizerNotificationClaim.deleteMany({ where: { key } });
    }
});

// --- Venta confirmada ---

testWithDb("sale-confirmed OFF (default): confirming a real sale never attempts a Resend call", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const restoreFetch = mockResendFetchSuccessOnly();
    try {
        // No settings row saved -> defaults -> saleConfirmedEnabled=false.
        // Si el hook ignorara el flag, el mock de fetch de arriba lanzaría
        // por una llamada inesperada a Resend y este test fallaría.
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId });
    } finally {
        restoreFetch();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("sale-confirmed ON: a real CONFIRMED sale sends exactly one notification, and re-confirming (replay) never duplicates it", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const restoreEnv = withMockedResendEnv();
    let sendCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            sendCount += 1;
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    try {
        await replaceOrganizerNotificationSettingsService(owner.clerkId, {
            saleConfirmedEnabled: true, salesMilestoneEnabled: false, salesMilestoneCount: 100,
            lowStockEnabled: false, lowStockPercent: 20, eventReminderEnabled: false,
            eventReminderHoursBefore: 24, eventStartEnabled: false, eventEndEnabled: false, scannerActivityEnabled: false,
        });

        const { sale } = await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId });
        assert.equal(sendCount, 1, "la primera confirmación real debe mandar exactamente una notificación de venta confirmada");

        // Re-confirmar la MISMA venta (idempotencia — reintento de
        // frontend, doble click, StrictMode): entra por la rama "ya
        // estaba CONFIRMED" y nunca vuelve a llegar al bloque de
        // Notificaciones Organizer.
        await confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true });
        assert.equal(sendCount, 1, "re-confirmar una venta ya CONFIRMED no debe duplicar la notificación");
    } finally {
        globalThis.fetch = original;
        restoreEnv();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// --- Hito de ventas ---

testWithDb("sales milestone: crossing the configured count sends one notification, claimed persistently (never twice)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 20 });
    const restoreEnv = withMockedResendEnv();
    const restoreFetch = mockResendFetchSuccessOnly();
    try {
        await replaceOrganizerNotificationSettingsService(owner.clerkId, {
            saleConfirmedEnabled: false, salesMilestoneEnabled: true, salesMilestoneCount: 5,
            lowStockEnabled: false, lowStockPercent: 20, eventReminderEnabled: false,
            eventReminderHoursBefore: 24, eventStartEnabled: false, eventEndEnabled: false, scannerActivityEnabled: false,
        });

        // Primera venta: 4 entradas — no cruza el hito de 5 todavía.
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, quantity: 4 });
        const claimAfterFirst = await prisma.organizerNotificationClaim.findUnique({ where: { key: `sales-milestone:${org.id}:5` } });
        assert.equal(claimAfterFirst, null, "4 entradas vendidas no debe cruzar un hito de 5");

        // Segunda venta: +2 (total 6) — cruza el hito de 5.
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, quantity: 2 });
        const claimAfterSecond = await prisma.organizerNotificationClaim.findUnique({ where: { key: `sales-milestone:${org.id}:5` } });
        assert.ok(claimAfterSecond, "6 entradas vendidas debe haber cruzado y reclamado el hito de 5");
    } finally {
        restoreFetch();
        restoreEnv();
        await prisma.organizerNotificationClaim.deleteMany({ where: { key: `sales-milestone:${org.id}:5` } });
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// --- Stock bajo / Agotado ---

testWithDb("sold out (mandatory): the sale that exhausts the last unit sends SOLD_OUT even with no settings saved", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 2 });
    const restoreEnv = withMockedResendEnv();
    let sentTypes = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            sentTypes.push(body.subject);
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    try {
        // No se guardó ninguna fila de OrganizerNotificationSettings — la
        // alerta obligatoria de agotado no depende de ningún flag.
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, quantity: 2 });
        assert.ok(sentTypes.some((s) => s.includes("agotaron")), "la venta que agota el stock debe mandar la notificación de agotado, sin ninguna preferencia configurada");
    } finally {
        globalThis.fetch = original;
        restoreEnv();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("low stock ON: crossing the configured percent from above sends LOW_STOCK exactly once, and a later sale within the same tier doesn't repeat it", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { quantity: 10 });
    const restoreEnv = withMockedResendEnv();
    let lowStockCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            if (body.subject.includes("Stock bajo")) lowStockCount += 1;
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    try {
        await replaceOrganizerNotificationSettingsService(owner.clerkId, {
            saleConfirmedEnabled: false, salesMilestoneEnabled: false, salesMilestoneCount: 100,
            lowStockEnabled: true, lowStockPercent: 50, eventReminderEnabled: false,
            eventReminderHoursBefore: 24, eventStartEnabled: false, eventEndEnabled: false, scannerActivityEnabled: false,
        });

        // Capacidad 10, umbral 50% = 5. Comprar 6 de una: 10 -> 4, cruza 5.
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, quantity: 6 });
        assert.equal(lowStockCount, 1, "cruzar el umbral de 50% debe notificar exactamente una vez");

        // Otra venta más (4 -> 2) sigue por debajo del umbral: no debe
        // volver a notificar (ya estaba cruzado antes de ESTA venta).
        await buySale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, quantity: 2 });
        assert.equal(lowStockCount, 1, "una venta posterior que sigue por debajo del umbral no debe repetir la notificación");
    } finally {
        globalThis.fetch = original;
        restoreEnv();
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// --- WithdrawalRequest (obligatoria, regresión del email generalizado) ---

testWithDb("withdrawal request: creating a new request still sends the organizer notification (generalized sender)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const restoreEnv = withMockedResendEnv();
    const restoreFetch = mockResendFetchSuccessOnly();
    const email = `wrq_${uniqueSuffix()}@example.com`;
    try {
        const buyerUser = await prisma.user.create({ data: { email, firstName: "Compradora", clerkId: null } });
        const sale = await createSaleForBuyer(buyerUser, {
            eventId: event.id, functionId: eventFunction.id,
            items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222",
        });
        await confirmSaleService(owner.clerkId, sale.id, { skipAutoEmail: true });
        const confirmedSale = await prisma.sale.findUnique({ where: { id: sale.id } });

        const result = await createWithdrawalRequestService(confirmedSale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" });
        assert.equal(result.alreadyExisted, false);
        assert.equal(result.status, "REQUESTED");
    } finally {
        restoreFetch();
        restoreEnv();
        await prisma.withdrawalRequest.deleteMany({ where: { eventId: event.id } });
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

// --- Mercado Pago desconectado (obligatoria) ---

testWithDb("MP disconnected: disconnecting an ACTIVE connection notifies once; disconnecting an already-DISCONNECTED one never notifies again", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restoreEnv = withMockedResendEnv();
    let sendCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            sendCount += 1;
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    const connection = await prisma.mercadoPagoConnection.create({
        data: {
            organizationId: org.id,
            mercadoPagoUserId: `mp-user-${uniqueSuffix()}`,
            accessTokenEncrypted: "fake-encrypted-access-token",
            refreshTokenEncrypted: "fake-encrypted-refresh-token",
            accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
            status: "ACTIVE",
        },
    });
    try {
        await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        assert.equal(sendCount, 1, "desconectar una conexión ACTIVE real debe notificar exactamente una vez");

        await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        assert.equal(sendCount, 1, "desconectar de nuevo (ya DISCONNECTED) nunca debe notificar otra vez");
    } finally {
        globalThis.fetch = original;
        restoreEnv();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], mercadoPagoConnectionIds: [connection.id] });
    }
});
