import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { findConfirmedRecoverableSales } from "../src/services/sale.service.js";
import { requestSaleRecoveryCodeService, verifySaleRecoveryCodeService } from "../src/services/saleRecoveryVerification.service.js";

// "Recuperar mis entradas" (ver el informe de la ronda "Recuperación de
// entradas") — findConfirmedRecoverableSales() sólo debe devolver compras
// CONFIRMED, con tickets reales no eliminados, y de una función VIGENTE O
// FUTURA (isFunctionFinished, misma regla temporal canónica que
// eventArchive.service.js — nunca una regla nueva). Tests contra Postgres
// real (backend/.env.test), nunca mocks de Prisma — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createOrganizationWithOwner() {
    const suffix = uniqueSuffix();
    const owner = await prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Owner", role: "ORGANIZER" },
    });
    const organization = await prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId: owner.id },
    });
    return { owner, organization };
}

async function createEvent(organizationId, title) {
    const suffix = uniqueSuffix();
    return prisma.event.create({
        data: { title, slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${suffix}`, organizationId, status: "PUBLISHED" },
    });
}

async function createFunction(eventId, { date, doorsOpenAt = null, endAt = null }) {
    return prisma.eventFunction.create({
        data: { eventId, date, doorsOpenAt, endAt, venue: "Plaza Central" },
    });
}

async function createTicketType(eventId) {
    const suffix = uniqueSuffix();
    return prisma.ticketType.create({
        data: { eventId, name: `General ${suffix}`, price: 1000, quantity: 100 },
    });
}

async function createBuyer(email) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { email, firstName: "Compradora", lastName: `Test${suffix}`, clerkId: null },
    });
}

// Arma una Sale CONFIRMED con N tickets reales — bypassa createSaleForBuyer
// a propósito (stock locks/emails/Mercado Pago no son parte de lo que se
// prueba acá, igual que eventPlanLimits.test.js simula archivedAt a mano en
// vez de pasar por todo el flujo de archivado).
async function createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument, ticketCount = 1, withToken = true, ticketsDeletedAt = [] }) {
    const sale = await prisma.sale.create({
        data: {
            status: "CONFIRMED",
            paymentMethod: "MANUAL",
            total: 1000 * ticketCount,
            buyerId: buyer.id,
            buyerDocument,
            eventId: event.id,
            functionId: eventFunction.id,
            confirmedAt: new Date(),
            publicRecoveryToken: withToken ? randomUUID() : null,
        },
    });

    const tickets = [];
    for (let i = 0; i < ticketCount; i++) {
        const ticket = await prisma.ticket.create({
            data: {
                ticketNumber: `TEST-${uniqueSuffix()}-${i}`,
                saleId: sale.id,
                eventId: event.id,
                functionId: eventFunction.id,
                ticketTypeId: ticketType.id,
                buyerId: buyer.id,
                ownerId: buyer.id,
                deletedAt: ticketsDeletedAt[i] ?? null,
            },
        });
        tickets.push(ticket);
    }

    return { sale, tickets };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function hoursFromNow(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// A) Sale CONFIRMED, función futura, email+DNI correctos, tickets válidos => aparece.
testWithDb("A: sale confirmada con función futura aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20111111";
    const buyer = await createBuyer(`recovery_a_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery A");
    const eventFunction = await createFunction(event.id, { date: hoursFromNow(48) });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument, ticketCount: 2 });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 1);
        assert.equal(results[0].eventTitle, "Recovery A");
        assert.equal(results[0].ticketCount, 2);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// B) Sale CONFIRMED, función ya finalizada => NO aparece.
testWithDb("B: sale confirmada con función ya finalizada NO aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20222222";
    const buyer = await createBuyer(`recovery_b_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery B");
    // Sin endAt: finishedBoundary = fin del día de `date`. hoursFromNow(-48)
    // garantiza que incluso el fin de ESE día ya pasó.
    const eventFunction = await createFunction(event.id, { date: hoursFromNow(-48) });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 0);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// C) Sale CONFIRMED, función hoy, sin endAt, antes de fin del día => aparece.
testWithDb("C: función de hoy sin endAt, antes de fin del día, aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20333333";
    const buyer = await createBuyer(`recovery_c_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery C");
    // `date` de hoy a una hora que ya pasó, pero el fin del día (23:59:59.999)
    // todavía no — isFunctionFinished debe seguir devolviendo false.
    const todayEarlier = new Date();
    todayEarlier.setHours(0, 1, 0, 0);
    const eventFunction = await createFunction(event.id, { date: todayEarlier });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 1);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// D) Sale CONFIRMED, función con endAt futuro => aparece.
testWithDb("D: función con endAt futuro aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20444444";
    const buyer = await createBuyer(`recovery_d_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery D");
    // `date` en el pasado pero `endAt` todavía futuro (evento largo, de
    // madrugada) — endAt manda, nunca `date` solo.
    const eventFunction = await createFunction(event.id, { date: hoursFromNow(-2), endAt: hoursFromNow(4) });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 1);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// E) Sale CONFIRMED, función con endAt pasado => NO aparece.
testWithDb("E: función con endAt pasado NO aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20555555";
    const buyer = await createBuyer(`recovery_e_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery E");
    const eventFunction = await createFunction(event.id, { date: hoursFromNow(-48), endAt: hoursFromNow(-46) });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 0);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// F) Sale con tickets eliminados solamente => NO aparece.
testWithDb("F: sale con sólo tickets eliminados NO aparece", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20666666";
    const buyer = await createBuyer(`recovery_f_${uniqueSuffix()}@example.com`);
    const event = await createEvent(organization.id, "Recovery F");
    const eventFunction = await createFunction(event.id, { date: hoursFromNow(48) });
    const ticketType = await createTicketType(event.id);

    try {
        await createConfirmedSale({
            event,
            eventFunction,
            ticketType,
            buyer,
            buyerDocument,
            ticketCount: 2,
            ticketsDeletedAt: [new Date(), new Date()],
        });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 0);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [organization.id], userIds: [owner.id, buyer.id] });
    }
});

// G) Sale CONFIRMED reciente => aparece primera por createdAt desc.
testWithDb("G: la compra más reciente aparece primera (createdAt desc)", async () => {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyerDocument = "20777777";
    const buyer = await createBuyer(`recovery_g_${uniqueSuffix()}@example.com`);
    const eventOld = await createEvent(organization.id, "Recovery G Old");
    const eventNew = await createEvent(organization.id, "Recovery G New");
    const functionOld = await createFunction(eventOld.id, { date: hoursFromNow(24) });
    const functionNew = await createFunction(eventNew.id, { date: hoursFromNow(48) });
    const ticketTypeOld = await createTicketType(eventOld.id);
    const ticketTypeNew = await createTicketType(eventNew.id);

    try {
        const { sale: oldSale } = await createConfirmedSale({
            event: eventOld,
            eventFunction: functionOld,
            ticketType: ticketTypeOld,
            buyer,
            buyerDocument,
        });
        // Fuerza un createdAt más viejo para la primera compra, sin
        // depender de un `await` extra que agregue latencia al test.
        await prisma.sale.update({ where: { id: oldSale.id }, data: { createdAt: hoursFromNow(-2) } });

        await createConfirmedSale({ event: eventNew, eventFunction: functionNew, ticketType: ticketTypeNew, buyer, buyerDocument });

        const results = await findConfirmedRecoverableSales(buyer.email, buyerDocument);
        assert.equal(results.length, 2);
        assert.equal(results[0].eventTitle, "Recovery G New");
        assert.equal(results[1].eventTitle, "Recovery G Old");
    } finally {
        await cleanup({
            eventIds: [eventOld.id, eventNew.id],
            organizationIds: [organization.id],
            userIds: [owner.id, buyer.id],
        });
    }
});

// ==================================================================
// Paso 1 con validación previa (ronda "validar match antes del OTP"):
// requestSaleRecoveryCodeService responde { matched, maskedEmail } para la
// COMBINACIÓN email+DNI, sólo envía código (y crea fila de verificación) si
// hay una compra vigente, y nunca devuelve datos de la compra antes del OTP.
// ==================================================================

// Intercepta Resend (mismo patrón que mercadoPagoBuyerRecovery.service.test.js)
// y captura el código de 6 dígitos realmente enviado.
function mockResendFetch() {
    const original = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes("api.resend.com/emails")) {
            const body = JSON.parse(opts.body);
            const match = String(body.text ?? "").match(/(\d{6})/);
            sent.push({ to: body.to, code: match ? match[1] : null });
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return {
        sent,
        restore: () => {
            globalThis.fetch = original;
        },
    };
}

async function countVerificationRows(normalizedEmail, normalizedDocument) {
    return prisma.saleRecoveryVerification.count({ where: { normalizedEmail, normalizedDocument } });
}

async function cleanupVerificationRows(pairs) {
    for (const [normalizedEmail, normalizedDocument] of pairs) {
        await prisma.saleRecoveryVerification.deleteMany({ where: { normalizedEmail, normalizedDocument } }).catch(() => {});
    }
}

// Arma comprador + compra vigente (y opcionalmente una vencida) para los
// tests de paso 1.
async function setupBuyerWithSales({ prefix, buyerDocument, withActive = true, withExpired = false }) {
    const { owner, organization } = await createOrganizationWithOwner();
    const buyer = await createBuyer(`${prefix}_${uniqueSuffix()}@example.com`);
    const eventIds = [];
    if (withActive) {
        const event = await createEvent(organization.id, `${prefix} Vigente`);
        eventIds.push(event.id);
        const eventFunction = await createFunction(event.id, { date: hoursFromNow(48) });
        const ticketType = await createTicketType(event.id);
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });
    }
    if (withExpired) {
        const event = await createEvent(organization.id, `${prefix} Vencida`);
        eventIds.push(event.id);
        const eventFunction = await createFunction(event.id, { date: hoursFromNow(-48) });
        const ticketType = await createTicketType(event.id);
        await createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument });
    }
    return { owner, organization, buyer, eventIds };
}

async function cleanupBuyerWithSales(ctx, verificationPairs) {
    await cleanupVerificationRows(verificationPairs);
    await cleanup({ eventIds: ctx.eventIds, organizationIds: [ctx.organization.id], userIds: [ctx.owner.id, ctx.buyer.id] });
}

testWithDb("OTP-A: email+DNI correctos con compra vigente => matched true y envía código", async () => {
    const buyerDocument = "30111111";
    const ctx = await setupBuyerWithSales({ prefix: "otp_a", buyerDocument });
    const mock = mockResendFetch();
    try {
        const result = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument });
        assert.equal(result.matched, true);
        assert.equal(mock.sent.length, 1);
        assert.match(mock.sent[0].code, /^\d{6}$/);
        assert.equal(await countVerificationRows(ctx.buyer.email, buyerDocument), 1);
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[ctx.buyer.email, buyerDocument]]);
    }
});

testWithDb("OTP-B: email correcto + DNI incorrecto => matched false, sin código ni fila", async () => {
    const buyerDocument = "30222222";
    const wrongDocument = "30222299";
    const ctx = await setupBuyerWithSales({ prefix: "otp_b", buyerDocument });
    const mock = mockResendFetch();
    try {
        const result = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument: wrongDocument });
        assert.equal(result.matched, false);
        assert.equal(mock.sent.length, 0);
        assert.equal(await countVerificationRows(ctx.buyer.email, wrongDocument), 0);
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[ctx.buyer.email, wrongDocument]]);
    }
});

testWithDb("OTP-C: email incorrecto + DNI correcto => matched false, sin código ni fila", async () => {
    const buyerDocument = "30333333";
    const ctx = await setupBuyerWithSales({ prefix: "otp_c", buyerDocument });
    const wrongEmail = `otp_c_wrong_${uniqueSuffix()}@example.com`;
    const mock = mockResendFetch();
    try {
        const result = await requestSaleRecoveryCodeService({ email: wrongEmail, buyerDocument });
        assert.equal(result.matched, false);
        assert.equal(mock.sent.length, 0);
        assert.equal(await countVerificationRows(wrongEmail, buyerDocument), 0);
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[wrongEmail, buyerDocument]]);
    }
});

testWithDb("OTP-D: email+DNI correctos pero sólo compras vencidas => matched false, sin código", async () => {
    const buyerDocument = "30444444";
    const ctx = await setupBuyerWithSales({ prefix: "otp_d", buyerDocument, withActive: false, withExpired: true });
    const mock = mockResendFetch();
    try {
        const result = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument });
        assert.equal(result.matched, false);
        assert.equal(mock.sent.length, 0);
        assert.equal(await countVerificationRows(ctx.buyer.email, buyerDocument), 0);
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[ctx.buyer.email, buyerDocument]]);
    }
});

testWithDb("OTP-E: vigente + vencida => matched true y, tras verificar, sólo devuelve la vigente", async () => {
    const buyerDocument = "30555555";
    const ctx = await setupBuyerWithSales({ prefix: "otp_e", buyerDocument, withActive: true, withExpired: true });
    const mock = mockResendFetch();
    try {
        const result = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument });
        assert.equal(result.matched, true);
        assert.equal(mock.sent.length, 1);

        const verified = await verifySaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument, code: mock.sent[0].code });
        assert.equal(verified.sales.length, 1);
        assert.equal(verified.sales[0].eventTitle, "otp_e Vigente");
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[ctx.buyer.email, buyerDocument]]);
    }
});

testWithDb("OTP-F: el paso 1 sólo devuelve matched + maskedEmail, nunca datos de la compra", async () => {
    const buyerDocument = "30666666";
    const wrongDocument = "30666699";
    const ctx = await setupBuyerWithSales({ prefix: "otp_f", buyerDocument });
    const mock = mockResendFetch();
    try {
        const matched = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument });
        const unmatched = await requestSaleRecoveryCodeService({ email: ctx.buyer.email, buyerDocument: wrongDocument });
        for (const result of [matched, unmatched]) {
            assert.deepEqual(Object.keys(result).sort(), ["maskedEmail", "matched"]);
            assert.notEqual(result.maskedEmail, ctx.buyer.email);
            assert.ok(!JSON.stringify(result).includes("otp_f Vigente"));
        }
        // Mismo maskedEmail con o sin match: depende sólo del email tipeado.
        assert.equal(matched.maskedEmail, unmatched.maskedEmail);
    } finally {
        mock.restore();
        await cleanupBuyerWithSales(ctx, [[ctx.buyer.email, buyerDocument], [ctx.buyer.email, wrongDocument]]);
    }
});
