import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createSaleForBuyer, confirmSaleService, getSaleStatusService, findWithdrawalEligibleSales } from "../src/services/sale.service.js";
import { createWithdrawalRequestService, returnWithdrawalRequestTicketsService } from "../src/services/withdrawalRequest.service.js";
import { cancelTicketService } from "../src/services/ticketAdmin.service.js";
import { scanTicketService } from "../src/services/scanner.service.js";
import { decryptSecret } from "../src/config/qrEncryption.js";

// Extensión del cierre del ciclo — "Ver entrada(s)" para el comprador +
// ventana informativa de 24h para una entrada devuelta. Sigue el mismo
// criterio de CRUD contra Postgres real que withdrawalRequestReturn.crud.test.js.
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía — mismo criterio que el resto de esta ronda: se deja
// escrito y registrado en dbTestFiles.js.
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
    return prisma.sale.findUnique({ where: { id: sale.id }, include: { tickets: { where: { deletedAt: null }, orderBy: { sequence: "asc" } } } });
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

// Simula el paso del tiempo sin cron/sleep: retrocede el createdAt de la
// fila TicketAuditLog que marcó la devolución (append-only, nunca se
// actualiza en producción — sólo un test manipula esto directamente para
// no tener que esperar 24hs reales).
async function backdateReturnAuditLog(ticketId, hoursAgo) {
    const log = await prisma.ticketAuditLog.findFirst({
        where: { ticketId, toStatus: "CANCELLED" },
        orderBy: { createdAt: "desc" },
    });
    await prisma.ticketAuditLog.update({
        where: { id: log.id },
        data: { createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) },
    });
}

const BUYER_DOCUMENT = "30111222";

testWithDb("1/8) a ticket returned <24h ago appears in the buyer's detail as DEVUELTA, with returnedAt set (the flag the frontend uses to suppress the QR)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis1_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const ticket = sale.tickets[0];
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]);

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        const returned = status.tickets.find((t) => t.id === ticket.id);
        assert.ok(returned, "the returned ticket must still be visible within the 24h window");
        assert.equal(returned.status, "CANCELLED");
        assert.ok(returned.returnedAt, "returnedAt must be set — this is the flag the frontend uses to render 'QR invalidado' instead of the real QR");
        assert.ok(returned.returnWindowExpiresAt);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("2) a ticket returned >=24h ago no longer appears in the buyer's active panel — but nothing is deleted from the DB", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis2_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const ticket = sale.tickets[0];
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticket.id]);
        await backdateReturnAuditLog(ticket.id, 25);

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(status.tickets.find((t) => t.id === ticket.id), undefined, "must disappear from the active panel after the 24h window");

        // Nada se borra — sigue existiendo, CANCELLED, con su auditoría.
        const stillThere = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        assert.equal(stillThere.status, "CANCELLED");
        assert.equal(stillThere.deletedAt, null);
        const auditRows = await prisma.ticketAuditLog.count({ where: { ticketId: ticket.id } });
        assert.ok(auditRows > 0, "TicketAuditLog history must be preserved");
        const requestRow = await prisma.withdrawalRequest.findUnique({ where: { id: request.id } });
        assert.equal(requestRow.status, "RESOLVED", "WithdrawalRequest history must be preserved");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("3) an ACTIVE ticket keeps appearing normally, with a usable qrToken", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis3_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(status.tickets.length, 1);
        assert.equal(status.tickets[0].status, "ACTIVE");
        assert.equal(status.tickets[0].returnedAt, null);
        assert.ok(status.tickets[0].qrToken.startsWith(sale.tickets[0].id));
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("4) a USED ticket keeps existing behavior — never treated as returned", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis4_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await prisma.ticket.update({ where: { id: sale.tickets[0].id }, data: { status: "USED" } });

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(status.tickets[0].status, "USED");
        assert.equal(status.tickets[0].returnedAt, null);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("5) a ticket CANCELLED by the ORDINARY admin panel (never touched by withdrawal-request) is never falsely shown as 'returned by the organizer' — and never disappears after 24h", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis5_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const ticket = sale.tickets[0];
        await cancelTicketService(owner.clerkId, event.id, ticket.id, { reason: "Motivo administrativo cualquiera, sin relación con el botón de arrepentimiento" });

        // Aunque hayan pasado >24h desde ESTA cancelación administrativa,
        // nunca se aplica la ventana de 24h — esa regla es EXCLUSIVA de
        // returnWithdrawalRequestTicketsService (ver metadata.source).
        await prisma.ticketAuditLog.updateMany({
            where: { ticketId: ticket.id },
            data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        });

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        const found = status.tickets.find((t) => t.id === ticket.id);
        assert.ok(found, "an ordinary CANCELLED ticket must never disappear from the panel, ever");
        assert.equal(found.status, "CANCELLED");
        assert.equal(found.returnedAt, null, "never falsely attributed to a withdrawal-request return");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("6/7) multi-ticket: A ACTIVE, B RETURNED, C ACTIVE — all three show correctly within 24h; only B disappears after 24h, A and C stay untouched", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis67_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT, quantity: 3 });
        const [ticketA, ticketB, ticketC] = sale.tickets;
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticketB.id]);

        const withinWindow = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(withinWindow.tickets.length, 3, "all three must be visible within the 24h window");
        const byId = Object.fromEntries(withinWindow.tickets.map((t) => [t.id, t]));
        assert.equal(byId[ticketA.id].status, "ACTIVE");
        assert.equal(byId[ticketA.id].returnedAt, null);
        assert.equal(byId[ticketB.id].status, "CANCELLED");
        assert.ok(byId[ticketB.id].returnedAt);
        assert.equal(byId[ticketC.id].status, "ACTIVE");
        assert.equal(byId[ticketC.id].returnedAt, null);

        await backdateReturnAuditLog(ticketB.id, 25);

        const afterWindow = await getSaleStatusService(sale.publicRecoveryToken);
        const idsAfter = afterWindow.tickets.map((t) => t.id).sort();
        assert.deepEqual(idsAfter, [ticketA.id, ticketC.id].sort(), "only B (>=24h) must disappear — A and C must never be hidden");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("9) the scanner/backend keeps rejecting a returned ticket's QR regardless of the 24h buyer-visibility window", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis9_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        const ticketRow = await prisma.ticket.findFirst({ where: { saleId: sale.id }, include: { qr: true } });
        const rawToken = `${ticketRow.id}.${decryptSecret(ticketRow.qr.secretEncrypted)}`;

        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [ticketRow.id]);

        // Aunque el comprador todavía lo vea (<24h) en su panel como
        // "Devuelta", el scanner real lo sigue rechazando siempre — la
        // ventana de 24h es puramente informativa para el comprador, nunca
        // reactiva la validez real del QR.
        const scan = await scanTicketService({ eventId: event.id, gate: null, id: "test-scanner", name: "Test" }, { token: rawToken, eventId: event.id });
        assert.equal(scan.status, "CANCELLED");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("10) IDOR: a Sale's recoveryToken can never resolve to another Sale's tickets, and an unknown token never leaks anything", async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const fixtureA = await createEventWithTicketType(orgA.id, ownerA.id);
    const ownerB = await createUser();
    const orgB = await createOrganization(ownerB.id);
    const fixtureB = await createEventWithTicketType(orgB.id, ownerB.id);
    const emailA = `idorA_${uniqueSuffix()}@example.com`;
    const emailB = `idorB_${uniqueSuffix()}@example.com`;
    try {
        const saleA = await createConfirmedSale({ event: fixtureA.event, eventFunction: fixtureA.eventFunction, ticketType: fixtureA.ticketType, organizerClerkId: ownerA.clerkId, email: emailA, buyerDocument: BUYER_DOCUMENT });
        const saleB = await createConfirmedSale({ event: fixtureB.event, eventFunction: fixtureB.eventFunction, ticketType: fixtureB.ticketType, organizerClerkId: ownerB.clerkId, email: emailB, buyerDocument: BUYER_DOCUMENT });

        const statusA = await getSaleStatusService(saleA.publicRecoveryToken);
        const ticketIdsB = saleB.tickets.map((t) => t.id);
        assert.ok(
            statusA.tickets.every((t) => !ticketIdsB.includes(t.id)),
            "Sale A's token must never resolve any of Sale B's tickets"
        );

        await assert.rejects(
            () => getSaleStatusService(`unknown-token-${uniqueSuffix()}`),
            (err) => {
                assert.equal(err.code, "SALE_NOT_FOUND");
                return true;
            }
        );
    } finally {
        await cleanup({ eventIds: [fixtureA.event.id, fixtureB.event.id], organizationIds: [orgA.id, orgB.id], userIds: [ownerA.id, ownerB.id] });
        await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    }
});

testWithDb("11) after a resolution (RESOLVED), findWithdrawalEligibleSales never shows it as a pending request needing 'Volver a contactar'/'Descartar solicitud'", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis11_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });
        const request = await prisma.withdrawalRequest.findFirst({ where: { saleId: sale.id } });
        await returnWithdrawalRequestTicketsService(owner.clerkId, request.id, [sale.tickets[0].id]);

        const sales = await findWithdrawalEligibleSales(email.toLowerCase(), BUYER_DOCUMENT);
        // El ticket YA no tiene ningún status distinto de REFUNDED que lo
        // haga elegible salvo que haya otros tickets ACTIVE en la Sale — en
        // este caso de 1 solo ticket, la Sale ya no ofrece "Solicitar" de
        // nuevo sobre nada porque no hay ningún ticket ACTIVE/USED restante
        // (CANCELLED no es REFUNDED, así que sigue technically eligible por
        // el filtro actual — lo que interesa acá es que NUNCA aparece como
        // solicitud pendiente).
        const found = sales.find((s) => s.saleToken === sale.publicRecoveryToken);
        if (found) {
            assert.equal(found.existingRequestStatus, null, "a RESOLVED request must never be surfaced as REQUESTED/CONTACTED");
            assert.equal(found.withdrawalRequestId, null);
        }
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("13) 'Ver entrada(s)' works for a Sale with no WithdrawalRequest at all", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis13_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT, quantity: 2 });

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(status.tickets.length, 2);
        assert.ok(status.tickets.every((t) => t.status === "ACTIVE" && t.returnedAt === null));
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("14) 'Ver entrada(s)' works for a Sale with a still-PENDING WithdrawalRequest (nothing resolved yet)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { event, eventFunction, ticketType } = await createEventWithTicketType(org.id, owner.id);
    const email = `vis14_${uniqueSuffix()}@example.com`;
    try {
        const sale = await createConfirmedSale({ event, eventFunction, ticketType, organizerClerkId: owner.clerkId, email, buyerDocument: BUYER_DOCUMENT });
        await createWithdrawalRequestService(sale.publicRecoveryToken, { reason: "OTRO" });

        const status = await getSaleStatusService(sale.publicRecoveryToken);
        assert.equal(status.tickets.length, 1);
        assert.equal(status.tickets[0].status, "ACTIVE");
        assert.equal(status.tickets[0].returnedAt, null, "a merely PENDING request must never affect ticket visibility/status");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
        await prisma.user.deleteMany({ where: { email } });
    }
});
