import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService, findWithdrawalEligibleSales } from "../src/services/sale.service.js";
import {
    createWithdrawalRequestService,
    dismissWithdrawalRequestService,
    returnWithdrawalRequestTicketsService,
} from "../src/services/withdrawalRequest.service.js";
import { getUnavailableCount } from "../src/services/functionCapacity.service.js";
import { scanTicketService } from "../src/services/scanner.service.js";
import { decryptSecret } from "../src/config/qrEncryption.js";

// Botón de arrepentimiento — cierre del ciclo ("Descartar solicitud" /
// "Marcar entrada como devuelta"). CRUD + concurrencia contra Postgres
// real (backend/.env.test), mismo criterio que withdrawalRequest.crud.test.js.
// Archivo PROPIO (no se agrega a ese) para mantener organizados los tests
// de esta ronda puntual. Guardrail centralizado — ver tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía (el usuario pidió explícitamente no correr test:db
// esta ronda) — queda escrito y registrado en dbTestFiles.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 7).toString("base64");

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

async function createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId, email, buyerDocument, quantity = 1 }) {
    const buyerUser = await prisma.user.create({ data: { email, firstName: "Compradora", clerkId: null } });
    const sale = await createSaleForBuyer(buyerUser, {
        eventId: event.id,
        functionId: eventFunction.id,
        items: [{ ticketTypeId: ticketType.id, quantity }],
        buyerDocument,
    });
    await confirmSaleService(organizerClerkId, sale.id, { skipAutoEmail: true });
    return prisma.sale.findUnique({ where: { id: sale.id }, include: { tickets: { where: { deletedAt: null }, include: { qr: true } } } });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.withdrawalRequest.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketAuditLog.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.scanAttempt.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.checkIn.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
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

const BUYER_DOCUMENT = "30111222";

// --- Descartar solicitud (comprador) ---

testWithDb("1) a buyer can dismiss their own pending request", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `dismiss1_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });

        const result = await dismissWithdrawalRequestService(sale.publicRecoveryToken);
        assert.equal(result.dismissed, true);

        const row = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        assert.equal(row.status, "DISMISSED");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("2) dismissing with an unknown/manipulated token never resolves to any Sale (IDOR check, same pattern as createWithdrawalRequestService)", async () => {
    await assert.rejects(
        () => dismissWithdrawalRequestService(`totally-made-up-token-${uniqueSuffix()}`),
        (err) => {
            assert.equal(err.code, "WITHDRAWAL_REQUEST_SALE_NOT_FOUND");
            return true;
        }
    );
});

testWithDb("3) dismissing a request never touches the Ticket or its availability", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `dismiss3_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const before = await getUnavailableCount(prisma, ticketType.id, eventFunction.id);

        await dismissWithdrawalRequestService(sale.publicRecoveryToken);

        const ticket = await prisma.ticket.findFirst({ where: { saleId: sale.id } });
        assert.equal(ticket.status, "ACTIVE");
        const after = await getUnavailableCount(prisma, ticketType.id, eventFunction.id);
        assert.equal(after, before, "dismissing must never change availability");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("4) after dismissing, the buyer can start a new request for the same Sale (DISMISSED is not in the active partial unique index)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `dismiss4_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        await dismissWithdrawalRequestService(sale.publicRecoveryToken);

        const second = await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "ARREPENTIMIENTO" });
        assert.equal(second.alreadyExisted, false, "a fresh request must be created, never collide with the dismissed one");

        const rows = await prisma.withdrawalRequest.count({ where: { saleId: sale.id } });
        assert.equal(rows, 2, "the dismissed row AND the new active row must both exist — history preserved");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

// --- "Volver a contactar" (WhatsApp verificado -> fallback email) ---

testWithDb("5) findWithdrawalEligibleSales offers WhatsApp contact only for a Sale with an active request AND a VERIFIED organization phone", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phone: "+54 9 351 412-3456", phoneVerifiedAt: new Date() });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `contact5_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });

        const sales = await findWithdrawalEligibleSales(email.toLowerCase(), BUYER_DOCUMENT);
        assert.equal(sales.length, 1);
        assert.ok(sales[0].withdrawalRequestId);
        assert.ok(sales[0].contact?.whatsappUrl?.startsWith("https://wa.me/549351"));
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("6) findWithdrawalEligibleSales falls back to email when the organization phone is NOT verified", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phone: "+54 9 351 412-3456", phoneVerifiedAt: null });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `contact6_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });

        const sales = await findWithdrawalEligibleSales(email.toLowerCase(), BUYER_DOCUMENT);
        assert.equal(sales[0].contact?.whatsappUrl, null, "an unverified phone must never be offered as WhatsApp contact");
        assert.equal(sales[0].contact?.email, org.email);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("a Sale without any active request never exposes organization contact info", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phoneVerifiedAt: new Date() });
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `contact7_${uniqueSuffix()}@example.com`;
    try {
        await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        const sales = await findWithdrawalEligibleSales(email.toLowerCase(), BUYER_DOCUMENT);
        assert.equal(sales[0].existingRequestStatus, null);
        assert.equal(sales[0].contact, null, "never reveal organizer contact before a request exists");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

// --- "Marcar entrada como devuelta" (organizador) ---

testWithDb("7/9) the correct organizer can mark a ticket as returned — the request resolves and the ticket is invalidated", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `return7_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const created = await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        void created;

        const ticket = sale.tickets[0];
        const result = await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]);
        assert.equal(result.status, "RESOLVED");

        const updatedTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        assert.equal(updatedTicket.status, "CANCELLED", "the returned ticket must be invalidated (CANCELLED, never REFUNDED)");

        const auditLog = await prisma.ticketAuditLog.findFirst({ where: { ticketId: ticket.id, action: "CANCEL" } });
        assert.ok(auditLog, "must leave an audit trail, same as ticketAdmin.service.js#cancelTicketService");
        assert.equal(auditLog.actorType, "ORGANIZER");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("8) an unrelated organizer can never mark another organization's ticket as returned (IDOR)", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const fixtureA = await createEventWithTicketType(orgA.id, ownerA.id);
    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    const emailA = `idorA_${uniqueSuffix()}@example.com`;
    try {
        const saleA = await createConfirmedSale({ event: fixtureA.event, eventFunction: fixtureA.eventFunction, ticketType: fixtureA.ticketType, organizerClerkId: ownerA.clerkId, email: emailA, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(saleA.publicRecoveryToken, { reason: "OTRO" });
        const requestA = await prisma.withdrawalRequest.findFirst({ where: { saleId: saleA.id } });
        const ticketA = saleA.tickets[0];

        await assert.rejects(
            () => returnWithdrawalRequestTicketsService(ownerB.clerkId, requestA.id, [ticketA.id]),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_REQUEST_SALE_NOT_FOUND");
                return true;
            }
        );

        const stillActive = await prisma.ticket.findUnique({ where: { id: ticketA.id } });
        assert.equal(stillActive.status, "ACTIVE", "Organizer B's rejected attempt must never touch Organizer A's ticket");
    } finally {
        await cleanup({ eventIds: [fixtureA.event.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
        await prisma.user.deleteMany({ where: { email: emailA } });
    }
});

// --- QR / disponibilidad / usado ---

testWithDb("10) a ticket marked as returned is rejected by the real scanner validation (scanTicketService) — a screenshot of the old QR no longer works", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `qr10_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const ticket = sale.tickets[0];
        const rawToken = `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`;

        // Antes de devolver: el QR real escanea VALID/READY.
        const before = await scanTicketService({ eventId: event.id, gate: null, id: "test-scanner", name: "Test" }, { token: rawToken, eventId: event.id });
        assert.equal(before.status, "READY");

        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]);

        // El MISMO token crudo (idéntico a una captura de pantalla vieja) —
        // el scanner real debe rechazarlo ahora.
        const after = await scanTicketService({ eventId: event.id, gate: null, id: "test-scanner", name: "Test" }, { token: rawToken, eventId: event.id });
        assert.equal(after.status, "CANCELLED");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("12/13) availability increases by EXACTLY one unit when one ticket out of a multi-ticket Sale is returned — a second return attempt never doubles it", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `avail12_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT, quantity: 2 });
        assert.equal(sale.tickets.length, 2, "fixture sanity check — this test needs a real multi-ticket Sale");
        const before = await getUnavailableCount(prisma, ticketType.id, eventFunction.id);

        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [sale.tickets[0].id]);

        const afterOne = await getUnavailableCount(prisma, ticketType.id, eventFunction.id);
        assert.equal(afterOne, before - 1, "returning ONE ticket out of two must free exactly one unit — the other stays sold/active");

        // Doble devolución — la solicitud ya está RESOLVED, debe rechazarse
        // sin volver a tocar disponibilidad.
        await assert.rejects(
            () => returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [sale.tickets[1].id]),
            (err) => {
                assert.equal(err.code, "WITHDRAWAL_REQUEST_NOT_ACTIVE");
                return true;
            }
        );
        const afterSecondAttempt = await getUnavailableCount(prisma, ticketType.id, eventFunction.id);
        assert.equal(afterSecondAttempt, afterOne, "a rejected second return must never change availability again");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("14) a USED (already checked-in) ticket cannot be marked as returned — clear domain error, and the whole operation rolls back (request stays active, no ticket touched)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `used14_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT, quantity: 2 });
        const [usedTicket, activeTicket] = sale.tickets;
        await prisma.ticket.update({ where: { id: usedTicket.id }, data: { status: "USED" } });

        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });

        await assert.rejects(
            () => returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [usedTicket.id]),
            (err) => {
                assert.equal(err.code, "TICKET_INVALID_TRANSITION");
                return true;
            }
        );

        const stillRequested = await prisma.withdrawalRequest.findUnique({ where: { id: request.id } });
        assert.equal(stillRequested.status, "REQUESTED", "the whole transaction must roll back — never leave the request RESOLVED without a real return");
        const stillUsed = await prisma.ticket.findUnique({ where: { id: usedTicket.id } });
        assert.equal(stillUsed.status, "USED");
        const stillActiveOther = await prisma.ticket.findUnique({ where: { id: activeTicket.id } });
        assert.equal(stillActiveOther.status, "ACTIVE", "an unrelated ticket in the same batch attempt must also stay untouched");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

// --- Concurrencia ---

testWithDb("15) two simultaneous 'mark as returned' clicks on the same request never double-process — exactly one wins, the ticket is cancelled exactly once", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `race15_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        const ticket = sale.tickets[0];

        const results = await Promise.allSettled([
            returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]),
            returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactly one of the two concurrent attempts must succeed");
        assert.equal(rejected[0].reason.code, "WITHDRAWAL_REQUEST_NOT_ACTIVE");

        const auditLogs = await prisma.ticketAuditLog.count({ where: { ticketId: ticket.id, action: "CANCEL" } });
        assert.equal(auditLogs, 1, "never a duplicate audit row from the losing attempt");
        const finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        assert.equal(finalTicket.status, "CANCELLED");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("16) a buyer dismissing while the organizer simultaneously marks it returned never leaves a hybrid state — exactly one outcome wins cleanly", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `race16_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        const ticket = sale.tickets[0];

        const [dismissResult, returnResult] = await Promise.allSettled([
            dismissWithdrawalRequestService(sale.publicRecoveryToken),
            returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]),
        ]);

        const finalRequest = await prisma.withdrawalRequest.findUnique({ where: { id: request.id } });
        const finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });

        if (finalRequest.status === "RESOLVED") {
            // El return ganó la carrera.
            assert.equal(finalTicket.status, "CANCELLED");
            assert.equal(returnResult.status, "fulfilled");
            assert.equal(dismissResult.value?.dismissed, false, "dismiss must lose gracefully (no-op), never throw, never partially apply");
        } else {
            // El dismiss ganó la carrera.
            assert.equal(finalRequest.status, "DISMISSED");
            assert.equal(finalTicket.status, "ACTIVE", "if dismiss won, the ticket must never have been touched");
            assert.equal(returnResult.status, "rejected");
            assert.equal(returnResult.reason.code, "WITHDRAWAL_REQUEST_NOT_ACTIVE");
        }
        // Cualquiera sea el ganador, nunca un híbrido (RESOLVED+ACTIVE o
        // DISMISSED+CANCELLED serían ambos estados imposibles).
        assert.ok(
            !(finalRequest.status === "RESOLVED" && finalTicket.status === "ACTIVE"),
            "impossible state: request RESOLVED but ticket still ACTIVE"
        );
        assert.ok(
            !(finalRequest.status === "DISMISSED" && finalTicket.status === "CANCELLED"),
            "impossible state: request DISMISSED but ticket got cancelled anyway"
        );
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});
