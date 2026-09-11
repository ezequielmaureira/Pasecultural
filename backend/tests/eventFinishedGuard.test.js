import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService } from "../src/services/sale.service.js";
import { issueCourtesyService } from "../src/services/courtesy.service.js";
import { markTicketUsedManuallyService, cancelTicketService } from "../src/services/ticketAdmin.service.js";
import { scanTicketService, confirmScanService } from "../src/services/scanner.service.js";
import { decryptSecret } from "../src/config/qrEncryption.js";
import { createEventService, syncEventScheduleService, updateMyEventService } from "../src/services/event.service.js";

// EVENT_FINISHED_GUARD — regla "evento finalizado = evento finalizado".
// CRUD + transacciones reales, no expresable como funciones puras: se
// prueba contra Postgres real (backend/.env.test). Guardrail centralizado —
// ver tests/helpers/dbGuard.js (NUNCA un segundo guardrail casero).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 6).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
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
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

// `finished: true` arma la función 2 días en el pasado (sin doorsOpenAt/
// endAt, así que getFunctionEndBoundary cae en fin del día de `date` — ya
// pasó). `finished: false` (default) la deja 7 días en el futuro.
async function createEventWithTicketType(organizationId, createdBy, { price = 10000, quantity = 100, maxPerPurchase = 10, finished = false } = {}) {
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId, createdBy, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const date = finished ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date, venue: "Teatro de prueba", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price, quantity, maxPerPurchase } });
    await prisma.functionTicketType.create({ data: { functionId: eventFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    return { event, eventFunction, ticketType };
}

async function createGuestBuyer() {
    const suffix = uniqueSuffix();
    return prisma.user.create({ data: { email: `buyer_${suffix}@example.com`, firstName: "Compradora", lastName: "Test" } });
}

function locationInput(overrides = {}) {
    return {
        venueName: "Plaza Central",
        formattedAddress: "Calle Falsa 123",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.scanAttempt.deleteMany({ where: { eventId: { in: eventIds } } });
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
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// 1) evento vigente permite comprar.
testWithDb("EF-01: una función vigente permite crear la Sale normalmente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: false });
    const buyer = await createGuestBuyer();
    try {
        const sale = await createSaleForBuyer(
            buyer,
            { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
            { origin: "SALE" }
        );
        assert.equal(sale.status, "PENDING");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// 2/3/4/6) evento finalizado rechaza compra (paga y gratuita), sin tocar
// stock ni crear Sale.
testWithDb("EF-02: una función finalizada rechaza createSaleForBuyer con EVENT_FINISHED y no crea Sale ni toca stock", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: true, quantity: 5 });
    const buyer = await createGuestBuyer();
    try {
        await assert.rejects(
            createSaleForBuyer(
                buyer,
                { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
                { origin: "SALE" }
            ),
            (error) => {
                assert.equal(error.code, "EVENT_FINISHED");
                assert.equal(error.httpStatus, 409);
                return true;
            }
        );

        const saleCount = await prisma.sale.count({ where: { eventId: event.id } });
        assert.equal(saleCount, 0, "ninguna Sale debe haberse creado");

        const soldCount = await prisma.ticket.count({ where: { eventId: event.id } });
        assert.equal(soldCount, 0, "ningún ticket/stock debe haberse consumido");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// 8) evento finalizado bloquea cortesía nueva.
testWithDb("EF-03: una función finalizada rechaza issueCourtesyService con EVENT_FINISHED", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: true });
    try {
        await assert.rejects(
            issueCourtesyService(owner.clerkId, {
                eventId: event.id,
                functionId: eventFunction.id,
                ticketTypeId: ticketType.id,
                quantity: 1,
                deliveryMethod: "SHARE",
                reason: "OTHER",
            }),
            (error) => {
                assert.equal(error.code, "EVENT_FINISHED");
                return true;
            }
        );
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 9/10/11/16/19) scanner bloqueado (preview y confirmación) sobre una
// función finalizada, tanto por QR como por check-in manual del organizador
// — un ticket vigente (vendido antes de que la función terminara) sigue
// existiendo y siendo consultable, pero ya no puede ingresar.
testWithDb("EF-04: scanner y check-in manual rechazan un ticket ACTIVE cuando la función ya finalizó", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: false });
    const buyer = await createGuestBuyer();

    // La venta se hace ANTES de que la función termine (mismo caso que el
    // webhook de Mercado Pago: compra iniciada/confirmada en tiempo, la
    // función termina después) — createSaleForBuyer con la función todavía
    // vigente, exactamente igual al fixture EF-01.
    const sale = await createSaleForBuyer(
        buyer,
        { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
        { origin: "SALE" }
    );
    // No hay un flujo de test que confirme el pago simulado sin mockear
    // Mercado Pago completo (ver mercadoPagoWebhook.service.test.js) — para
    // esta suite alcanza con activar el Ticket directamente, que es lo único
    // que scanner.service.js/ticketAdmin.service.js necesitan ver.
    await prisma.sale.update({ where: { id: sale.id }, data: { status: "CONFIRMED" } });
    const ticketType2 = ticketType; // legibilidad
    const ticketQr = await prisma.ticketQr.findFirst({ where: { ticket: { saleId: sale.id } }, include: { ticket: true } });
    let ticket = ticketQr?.ticket;
    if (!ticket) {
        // El checkout guest/manual de esta suite no pasa por Mercado Pago
        // (nunca crea Ticket automáticamente al confirmar status): se crea a
        // mano para poder probar el guard del Scanner — mismo shape que
        // confirmSaleService, sin duplicar esa lógica de negocio completa.
        const { encryptSecret } = await import("../src/config/qrEncryption.js");
        const secret = randomUUID();
        ticket = await prisma.ticket.create({
            data: {
                event: { connect: { id: event.id } },
                function: { connect: { id: eventFunction.id } },
                ticketType: { connect: { id: ticketType2.id } },
                sale: { connect: { id: sale.id } },
                buyer: { connect: { id: buyer.id } },
                owner: { connect: { id: buyer.id } },
                ticketNumber: `TEST-${uniqueSuffix()}`,
                status: "ACTIVE",
                origin: "SALE",
            },
        });
        await prisma.ticketQr.create({ data: { ticketId: ticket.id, secretEncrypted: encryptSecret(secret) } });
    }
    const qr = await prisma.ticketQr.findUnique({ where: { ticketId: ticket.id } });
    const token = `${ticket.id}.${decryptSecret(qr.secretEncrypted)}`;

    // Ahora la función termina (ej: el reloj avanzó) — se mueve al pasado.
    await prisma.eventFunction.update({ where: { id: eventFunction.id }, data: { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });

    try {
        const scannerContext = { id: "test-scanner", eventId: event.id, gate: null, firstName: "Test", lastName: "Scanner", name: "Test Scanner" };

        const preview = await scanTicketService(scannerContext, { eventId: event.id, functionId: eventFunction.id, token });
        assert.equal(preview.status, "EVENT_FINISHED", "la vista previa rechaza un ticket ACTIVE de una función ya finalizada");

        const confirmation = await confirmScanService(scannerContext, { eventId: event.id, functionId: eventFunction.id, token });
        assert.equal(confirmation.status, "EVENT_FINISHED", "la confirmación de ingreso también lo rechaza");

        const checkInCount = await prisma.checkIn.count({ where: { ticketId: ticket.id } });
        assert.equal(checkInCount, 0, "una función finalizada nunca genera un CheckIn nuevo");

        // Decisión de la ronda: EVENT_FINISHED no es un valor del enum
        // Postgres ScanResult (sin migración) — confirmScanService nunca
        // intenta persistirlo. No debe haber NINGÚN ScanAttempt para este
        // ticket (ni siquiera con otro `result`): el `return` de
        // resolveScanOutcome es anterior a cualquier recordAttempt.
        const scanAttemptCount = await prisma.scanAttempt.count({ where: { ticketId: ticket.id } });
        assert.equal(scanAttemptCount, 0, "confirmScanService no debe escribir ningún ScanAttempt para EVENT_FINISHED");

        // Check-in manual del organizador (backoffice) — mismo guard.
        await assert.rejects(
            markTicketUsedManuallyService(owner.clerkId, event.id, ticket.id, { reason: "Test" }),
            (error) => {
                assert.equal(error.code, "EVENT_FINISHED");
                return true;
            }
        );

        // El ticket sigue existiendo y siendo consultable — nunca se borra
        // ni se oculta por haber finalizado la función.
        const stillActive = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        assert.equal(stillActive.status, "ACTIVE", "el ticket sigue consultable tal como estaba");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// 14) Decisión "fin por función": un Event con 2 funciones, una ya
// finalizada y otra vigente — la finalizada rechaza, la vigente sigue
// operativa. El Event completo NUNCA se cierra sólo porque una de sus
// funciones terminó.
testWithDb("EF-05: una función finalizada no afecta a otra función vigente del mismo Event", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const suffix = uniqueSuffix();
    const event = await prisma.event.create({
        data: { title: `Show ${suffix}`, slug: `show-${suffix}`, organizationId: org.id, createdBy: owner.id, status: "PUBLISHED", visibility: "PUBLIC" },
    });
    const finishedFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), venue: "Viernes", status: "SCHEDULED" },
    });
    const activeFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), venue: "Sábado", status: "SCHEDULED" },
    });
    const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", price: 10000, quantity: 100, maxPerPurchase: 10 } });
    await prisma.functionTicketType.create({ data: { functionId: finishedFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    await prisma.functionTicketType.create({ data: { functionId: activeFunction.id, ticketTypeId: ticketType.id, enabled: true } });
    const buyer = await createGuestBuyer();
    try {
        await assert.rejects(
            createSaleForBuyer(
                buyer,
                { eventId: event.id, functionId: finishedFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
                { origin: "SALE" }
            ),
            (error) => {
                assert.equal(error.code, "EVENT_FINISHED");
                return true;
            }
        );

        const sale = await createSaleForBuyer(
            buyer,
            { eventId: event.id, functionId: activeFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
            { origin: "SALE" }
        );
        assert.equal(sale.status, "PENDING", "la función del sábado sigue operativa aunque la del viernes ya haya terminado");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// 12/13) publicación rechazada sin endAt en alguna función, permitida
// cuando todas lo tienen. 11) un DRAFT puede guardar su agenda sin endAt.
testWithDb("EF-06: publicar sin hora de fin en alguna función se rechaza con EVENT_FUNCTION_END_REQUIRED; con endAt se permite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { status: "APPROVED" });
    const draft = await createEventService(owner.clerkId, { title: "EF-06", admissionType: "TICKETED", location: locationInput() }, org.id);
    try {
        // 11) DRAFT: guardar la agenda SIN endAt no está bloqueado —
        // syncEventScheduleService nunca corre assertPublishable. `date`/
        // `endAt` acá son datetimes ISO completos (ver buildFunctionData en
        // event.service.js) — distinto del shape date+startTime/endTime que
        // usa el flujo conversacional (EventServicePort.js).
        const scheduleWithoutEnd = {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        };
        await syncEventScheduleService(owner.clerkId, draft.id, scheduleWithoutEnd);

        // 12) Publicar SIN endAt se rechaza.
        await assert.rejects(
            updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id),
            (error) => {
                assert.equal(error.message, "EVENT_FUNCTION_END_REQUIRED");
                return true;
            }
        );

        const stillDraft = await prisma.event.findUnique({ where: { id: draft.id } });
        assert.equal(stillDraft.status, "DRAFT", "no debe haber quedado publicado");

        // 13) Reemplazar la agenda CON endTime permite publicar normalmente.
        const scheduleWithEnd = {
            ticketTypes: [{ name: "General", price: 10000, quantity: 50 }],
            functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central", ticketAssignments: [{ enabled: true }] }],
        };
        await syncEventScheduleService(owner.clerkId, draft.id, scheduleWithEnd);
        const published = await updateMyEventService(owner.clerkId, draft.id, { status: "PUBLISHED" }, org.id);
        assert.equal(published.status, "PUBLISHED", "con endAt cargado la publicación debe permitirse");
    } finally {
        await cleanup({ eventIds: [draft.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 10) operación administrativa histórica (corrección sobre un ticket ya
// existente) permitida después de que la función finalizó — a diferencia
// del check-in, nunca es una operación operativa nueva.
testWithDb("EF-07: cancelTicketService sigue permitido sobre un ticket de una función ya finalizada", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: false });
    const buyer = await createGuestBuyer();
    const sale = await createSaleForBuyer(
        buyer,
        { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
        { origin: "SALE" }
    );
    await prisma.sale.update({ where: { id: sale.id }, data: { status: "CONFIRMED" } });
    const ticket = await prisma.ticket.create({
        data: {
            event: { connect: { id: event.id } },
            function: { connect: { id: eventFunction.id } },
            ticketType: { connect: { id: ticketType.id } },
            sale: { connect: { id: sale.id } },
            buyer: { connect: { id: buyer.id } },
            owner: { connect: { id: buyer.id } },
            ticketNumber: `TEST-${uniqueSuffix()}`,
            status: "ACTIVE",
            origin: "SALE",
        },
    });
    // La función termina después de emitido el ticket.
    await prisma.eventFunction.update({ where: { id: eventFunction.id }, data: { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });

    try {
        const cancelled = await cancelTicketService(owner.clerkId, event.id, ticket.id, { reason: "Corrección administrativa" });
        assert.equal(cancelled.status, "CANCELLED", "una corrección administrativa sobre un ticket existente sigue permitida aunque la función ya haya finalizado");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});

// 15) una Sale PENDING creada/confirmada por Mercado Pago ANTES del cierre
// puede seguir completándose (confirmSaleService) aunque la función ya haya
// terminado para cuando llega la notificación — confirmSaleService NUNCA
// pasa por assertFunctionActive (ver sale.service.js): sólo createSaleForBuyer
// lo hace, y esta Sale ya existía de antes.
testWithDb("EF-08: confirmSaleService completa una Sale PENDING creada antes del cierre aunque la función ya haya finalizado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id, { finished: false });
    const buyer = await createGuestBuyer();

    const sale = await createSaleForBuyer(
        buyer,
        { eventId: event.id, functionId: eventFunction.id, items: [{ ticketTypeId: ticketType.id, quantity: 1 }], buyerDocument: "30111222" },
        { origin: "SALE" }
    );
    assert.equal(sale.status, "PENDING");

    // La función termina DESPUÉS de creada la Sale (compra iniciada en
    // tiempo, confirmación de Mercado Pago llega tarde).
    await prisma.eventFunction.update({ where: { id: eventFunction.id }, data: { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });

    try {
        const confirmed = await confirmSaleService(owner.clerkId, sale.id);
        assert.equal(confirmed.sale.status, "CONFIRMED", "la Sale ya iniciada debe poder completarse aunque la función haya terminado mientras tanto");
        const ticketCount = await prisma.ticket.count({ where: { saleId: sale.id } });
        assert.equal(ticketCount, 1, "el ticket correspondiente debe haberse emitido normalmente");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id, buyer.id] });
    }
});
