import test from "node:test";
import assert from "node:assert/strict";

// Una entrada cuyo dinero fue devuelto (reembolso/contracargo de Mercado
// Pago o devolución por arrepentimiento) nunca vuelve a quedar utilizable
// por una acción del organizador, y el scanner nunca la admite. SIN base de
// datos: DATABASE_URL apunta a un puerto local cerrado ANTES de importar
// Prisma y los modelos que usa cada camino se reemplazan por un store en
// memoria. prisma.$transaction ejecuta el callback sobre ese mismo store y
// restaura el snapshot si el callback lanza (rollback). La API de Mercado
// Pago se simula con un fetch falso — nunca un refund ni un cargo real.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.TICKET_QR_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");

const { default: prisma } = await import("../src/config/prisma.js");
const ticketAdmin = await import("../src/services/ticketAdmin.service.js");
const { scanTicketService, confirmScanService } = await import("../src/services/scanner.service.js");
const { confirmMercadoPagoPaymentIfEligible } = await import("../src/services/mercadoPagoPaymentConfirmation.service.js");
const { encryptMercadoPagoSecret } = await import("../src/config/mercadoPagoEncryption.js");
const { encryptSecret } = await import("../src/config/qrEncryption.js");

const {
    findReactivationBlockedTicketIds,
    cancelTicketService,
    rehabilitateTicketService,
    reactivateUsedTicketService,
    markTicketUsedManuallyService,
    bulkApplyTicketActionService,
} = ticketAdmin;

// --- Store en memoria ------------------------------------------------------

const ORGANIZER = { id: "user-org", clerkId: "clerk_org", role: "ORGANIZER" };
const ORGANIZATION = { id: "org-1", ownerId: ORGANIZER.id, closedAt: null, name: "Sala" };
const EVENT = { id: "event-1", organizationId: ORGANIZATION.id, archivedAt: null, title: "Show" };
const FUTURE_FUNCTION = { id: "fn-1", date: new Date(Date.now() + 7 * 864e5), doorsOpenAt: null, endAt: null, venue: "Sala" };
const WITHDRAWAL_SOURCE = "WITHDRAWAL_REQUEST_RETURN";

const db = { tickets: new Map(), auditLogs: [], reversalEvents: [], checkIns: [], sales: new Map(), scanAttempts: [] };
const QR_SECRET = "qr-secret-value";

function matchesWhere(row, where = {}) {
    return Object.entries(where).every(([key, cond]) => {
        if (cond && typeof cond === "object" && !(cond instanceof Date)) {
            if ("in" in cond) return cond.in.includes(row[key]);
            if ("not" in cond) return row[key] !== cond.not;
            return true;
        }
        return row[key] === cond;
    });
}
function pick(row, select) {
    if (!row || !select) return row ? { ...row } : null;
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

const ticketModel = {
    findFirst: async ({ where }) => pick([...db.tickets.values()].find((t) => matchesWhere(t, where))),
    findMany: async ({ where, select }) => [...db.tickets.values()].filter((t) => matchesWhere(t, where)).map((t) => pick(t, select)),
    findUnique: async ({ where }) => {
        const t = db.tickets.get(where.id);
        if (!t) return null;
        return {
            ...t,
            qr: { secretEncrypted: t.qrEncrypted },
            buyer: { firstName: "Ana", lastName: "Test" },
            ticketType: { name: "General" },
            event: { title: EVENT.title },
            function: FUTURE_FUNCTION,
        };
    },
    update: async ({ where, data }) => {
        const t = db.tickets.get(where.id);
        Object.assign(t, data);
        return { ...t };
    },
    updateMany: async ({ where, data }) => {
        let count = 0;
        for (const t of db.tickets.values()) {
            if (matchesWhere(t, where)) {
                Object.assign(t, data);
                count += 1;
            }
        }
        return { count };
    },
};
const auditModel = {
    create: async ({ data }) => db.auditLogs.push({ ...data, createdAt: new Date() }),
    createMany: async ({ data }) => data.forEach((d) => db.auditLogs.push({ ...d, createdAt: new Date() })),
    findMany: async ({ where }) =>
        db.auditLogs
            .filter((l) => where.ticketId.in.includes(l.ticketId) && l.toStatus === where.toStatus)
            .sort((a, b) => b.createdAt - a.createdAt),
};
const reversalModel = {
    findMany: async ({ where }) => db.reversalEvents.filter((e) => where.saleId.in.includes(e.saleId)).map((e) => ({ saleId: e.saleId })),
    create: async ({ data }) => db.reversalEvents.push({ ...data }),
    count: async () => 0,
};
const txClient = {
    ticket: ticketModel,
    ticketAuditLog: auditModel,
    developerAlertReversalEvent: reversalModel,
    checkIn: {
        create: async ({ data }) => db.checkIns.push(data),
        findFirst: async ({ where }) => db.checkIns.filter((c) => c.ticketId === where.ticketId).at(-1) ?? null,
    },
    scanAttempt: { create: async ({ data }) => db.scanAttempts.push(data) },
};

let transactionCalls = 0;
Object.assign(prisma.ticket, ticketModel);
Object.assign(prisma.ticketAuditLog, auditModel);
Object.assign(prisma.developerAlertReversalEvent, reversalModel);
Object.assign(prisma.checkIn, txClient.checkIn);
prisma.$transaction = async (fn) => {
    transactionCalls += 1;
    const snapshot = new Map([...db.tickets].map(([id, t]) => [id, { ...t }]));
    const auditLen = db.auditLogs.length;
    const checkInLen = db.checkIns.length;
    try {
        return await fn(txClient);
    } catch (err) {
        db.tickets = snapshot;
        db.auditLogs.length = auditLen;
        db.checkIns.length = checkInLen;
        throw err;
    }
};
prisma.user.findUnique = async ({ where }) => (where.clerkId === ORGANIZER.clerkId || where.id === ORGANIZER.id ? { ...ORGANIZER } : null);
prisma.organization.findFirst = async () => ({ ...ORGANIZATION });
prisma.event.findMany = async () => [];
prisma.event.findUnique = async () => ({ ...EVENT });
prisma.eventFunction.findUnique = async () => ({ ...FUTURE_FUNCTION });
prisma.developerAlertConfig.findFirst = async () => null;

let seq = 0;
function addTicket({ status = "ACTIVE", saleId, origin = "SALE" } = {}) {
    seq += 1;
    const ticket = {
        id: `ticket-${seq}`,
        ticketNumber: `T-${seq}`,
        status,
        saleId: saleId ?? `sale-${seq}`,
        eventId: EVENT.id,
        functionId: FUTURE_FUNCTION.id,
        origin,
        deletedAt: null,
        qrEncrypted: encryptSecret(QR_SECRET),
    };
    db.tickets.set(ticket.id, ticket);
    return ticket;
}
const statusOf = (id) => db.tickets.get(id).status;

async function expectBlocked(promise, ticketId) {
    const before = statusOf(ticketId);
    await assert.rejects(promise, (err) => err.code === "TICKET_REFUNDED_CANNOT_REACTIVATE");
    assert.equal(statusOf(ticketId), before, "el ticket no debe modificarse");
}

// --- Regla pura -------------------------------------------------------------

test("findReactivationBlockedTicketIds distingue cancelación manual de dinero devuelto", async () => {
    const manual = addTicket({ status: "CANCELLED" });
    db.auditLogs.push({ ticketId: manual.id, toStatus: "CANCELLED", action: "CANCEL", metadata: null, createdAt: new Date() });
    const withdrawal = addTicket({ status: "CANCELLED" });
    db.auditLogs.push({ ticketId: withdrawal.id, toStatus: "CANCELLED", action: "CANCEL", metadata: { source: WITHDRAWAL_SOURCE }, createdAt: new Date() });
    const refunded = addTicket({ status: "REFUNDED" });
    const siblingCancelled = addTicket({ status: "CANCELLED", saleId: refunded.saleId });
    const siblingUsed = addTicket({ status: "USED", saleId: refunded.saleId });
    const usedOnlyReversed = addTicket({ status: "USED" });
    db.reversalEvents.push({ saleId: usedOnlyReversed.saleId, type: "CHARGED_BACK" });
    const normalUsed = addTicket({ status: "USED" });
    const active = addTicket();

    const blocked = await findReactivationBlockedTicketIds(
        [manual, withdrawal, refunded, siblingCancelled, siblingUsed, usedOnlyReversed, normalUsed, active].map((t) => ({ ...t }))
    );
    assert.deepEqual(
        [...blocked].sort(),
        [withdrawal.id, refunded.id, siblingCancelled.id, siblingUsed.id, usedOnlyReversed.id].sort()
    );
});

// --- Flujos legítimos intactos ----------------------------------------------

test("ACTIVE normal: cancelar y marcar usado funcionan", async () => {
    const a = addTicket();
    await cancelTicketService(ORGANIZER.clerkId, EVENT.id, a.id);
    assert.equal(statusOf(a.id), "CANCELLED");
    const b = addTicket();
    await markTicketUsedManuallyService(ORGANIZER.clerkId, EVENT.id, b.id);
    assert.equal(statusOf(b.id), "USED");
});

test("cancelación manual normal → puede rehabilitarse (individual y en lote)", async () => {
    const t = addTicket();
    await cancelTicketService(ORGANIZER.clerkId, EVENT.id, t.id);
    await rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, t.id);
    assert.equal(statusOf(t.id), "ACTIVE");

    const bulk = addTicket();
    await cancelTicketService(ORGANIZER.clerkId, EVENT.id, bulk.id);
    const updated = await bulkApplyTicketActionService(ORGANIZER.clerkId, EVENT.id, { ticketIds: [bulk.id], action: "rehabilitate" });
    assert.deepEqual(updated, [bulk.id]);
    assert.equal(statusOf(bulk.id), "ACTIVE");
});

test("USED normal (sin reversión) → puede reactivarse como antes", async () => {
    const t = addTicket({ status: "USED" });
    await reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, t.id);
    assert.equal(statusOf(t.id), "ACTIVE");
});

test("cortesía cancelada manualmente → sigue pudiendo rehabilitarse", async () => {
    const t = addTicket({ origin: "COURTESY" });
    await cancelTicketService(ORGANIZER.clerkId, EVENT.id, t.id);
    await rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, t.id);
    assert.equal(statusOf(t.id), "ACTIVE");
});

// --- REFUNDED y ventas con dinero devuelto ----------------------------------

test("REFUNDED → ningún endpoint de organizador lo vuelve utilizable", async () => {
    const t = addTicket({ status: "REFUNDED" });
    await assert.rejects(rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, t.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
    await assert.rejects(reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, t.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
    await assert.rejects(markTicketUsedManuallyService(ORGANIZER.clerkId, EVENT.id, t.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
    await assert.rejects(cancelTicketService(ORGANIZER.clerkId, EVENT.id, t.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
    const updated = await bulkApplyTicketActionService(ORGANIZER.clerkId, EVENT.id, { ticketIds: [t.id], action: "rehabilitate" });
    assert.deepEqual(updated, []);
    assert.equal(statusOf(t.id), "REFUNDED");
});

test("venta reembolsada: el ticket CANCELLED/USED que quedó fuera de la reversión no se rehabilita (individual ni en lote)", async () => {
    const refunded = addTicket({ status: "REFUNDED" });
    const cancelled = addTicket({ status: "CANCELLED", saleId: refunded.saleId });
    const used = addTicket({ status: "USED", saleId: refunded.saleId });
    await expectBlocked(rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, cancelled.id), cancelled.id);
    await expectBlocked(reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, used.id), used.id);
    const updated = await bulkApplyTicketActionService(ORGANIZER.clerkId, EVENT.id, {
        ticketIds: [cancelled.id, used.id, refunded.id],
        action: "rehabilitate",
    });
    assert.deepEqual(updated, []);
    assert.equal(statusOf(cancelled.id), "CANCELLED");
    assert.equal(statusOf(used.id), "USED");
});

test("contracargo sobre una venta con sólo tickets USED: la marca de reversión bloquea reactivar", async () => {
    const used = addTicket({ status: "USED" });
    db.reversalEvents.push({ saleId: used.saleId, type: "CHARGED_BACK" });
    await expectBlocked(reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, used.id), used.id);
});

test("ACTIVE residual en venta revertida: no puede marcarse usado manualmente", async () => {
    const active = addTicket();
    db.reversalEvents.push({ saleId: active.saleId, type: "REFUNDED" });
    await expectBlocked(markTicketUsedManuallyService(ORGANIZER.clerkId, EVENT.id, active.id), active.id);
});

test("devolución por arrepentimiento (CANCELLED con fuente de devolución) → no se rehabilita", async () => {
    const t = addTicket({ status: "CANCELLED" });
    db.auditLogs.push({ ticketId: t.id, toStatus: "CANCELLED", action: "CANCEL", metadata: { source: WITHDRAWAL_SOURCE }, createdAt: new Date() });
    await expectBlocked(rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, t.id), t.id);
    assert.deepEqual(await bulkApplyTicketActionService(ORGANIZER.clerkId, EVENT.id, { ticketIds: [t.id], action: "rehabilitate" }), []);
    assert.equal(statusOf(t.id), "CANCELLED");
});

test("carrera: una reversión que entra entre el chequeo y el update → rollback, el ticket no cambia", async () => {
    const t = addTicket({ status: "USED" });
    const originalUpdate = txClient.ticket.update;
    txClient.ticket.update = async (args) => {
        db.reversalEvents.push({ saleId: t.saleId, type: "REFUNDED" }); // llega justo ahora
        return originalUpdate(args);
    };
    try {
        await expectBlocked(reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, t.id), t.id);
    } finally {
        txClient.ticket.update = originalUpdate;
    }
});

// --- Mercado Pago: refund / chargeback reales simulados ---------------------

const CONNECTION = {
    id: "mpconn-1",
    organizationId: ORGANIZATION.id,
    mercadoPagoUserId: "999",
    status: "ACTIVE",
    accessTokenExpiresAt: new Date(Date.now() + 864e5),
    accessTokenEncrypted: encryptMercadoPagoSecret("APP_USR-test-token"),
};
prisma.mercadoPagoConnection.findUnique = async () => ({ ...CONNECTION });
prisma.mercadoPagoConnection.findFirst = async () => ({ ...CONNECTION });
prisma.sale.findUnique = async ({ where }) => {
    const all = [...db.sales.values()];
    if (where.mercadoPagoPaymentId !== undefined) return all.find((s) => s.mercadoPagoPaymentId === where.mercadoPagoPaymentId) ?? null;
    if (where.mercadoPagoExternalReference !== undefined) return all.find((s) => s.mercadoPagoExternalReference === where.mercadoPagoExternalReference) ?? null;
    return null;
};

function addConfirmedMpSale() {
    seq += 1;
    const sale = {
        id: `mpsale-${seq}`,
        status: "CONFIRMED",
        origin: "SALE",
        paymentMethod: "MERCADO_PAGO",
        total: 2000,
        eventId: EVENT.id,
        mercadoPagoExternalReference: `ext-${seq}`,
        mercadoPagoPaymentId: `pay-${seq}`,
        event: { ...EVENT, organization: ORGANIZATION },
    };
    db.sales.set(sale.id, sale);
    return sale;
}

function mockMercadoPago(sale, status) {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith("https://api.mercadopago.com/v1/payments/")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: sale.mercadoPagoPaymentId,
                    status,
                    transaction_amount: 2000,
                    currency_id: "ARS",
                    external_reference: sale.mercadoPagoExternalReference,
                    collector_id: 999,
                }),
            };
        }
        if (u.includes("api.resend.com")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: "resend-test" }) };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

for (const [mpStatus, label] of [["refunded", "REFUND"], ["charged_back", "CHARGEBACK"]]) {
    test(`${label} de Mercado Pago: ACTIVE → REFUNDED, marca de reversión durable, y después nada se puede reactivar`, async () => {
        const sale = addConfirmedMpSale();
        const active = addTicket({ saleId: sale.id });
        const cancelled = addTicket({ status: "CANCELLED", saleId: sale.id });
        const used = addTicket({ status: "USED", saleId: sale.id });
        const restore = mockMercadoPago(sale, mpStatus);
        try {
            const outcome = await confirmMercadoPagoPaymentIfEligible({ paymentId: sale.mercadoPagoPaymentId, source: "WEBHOOK" });
            assert.equal(outcome.action, "reversal_acknowledged");
        } finally {
            restore();
        }
        assert.equal(statusOf(active.id), "REFUNDED");
        assert.equal(statusOf(cancelled.id), "CANCELLED", "la reversión sólo toca ACTIVE (historial intacto)");
        assert.equal(statusOf(used.id), "USED", "la reversión sólo toca ACTIVE (historial intacto)");
        assert.ok(db.reversalEvents.some((e) => e.saleId === sale.id && e.type === (mpStatus === "refunded" ? "REFUNDED" : "CHARGED_BACK")));

        await assert.rejects(rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, active.id), (e) => e.code === "TICKET_INVALID_TRANSITION");
        await expectBlocked(rehabilitateTicketService(ORGANIZER.clerkId, EVENT.id, cancelled.id), cancelled.id);
        await expectBlocked(reactivateUsedTicketService(ORGANIZER.clerkId, EVENT.id, used.id), used.id);
        assert.deepEqual(
            await bulkApplyTicketActionService(ORGANIZER.clerkId, EVENT.id, { ticketIds: [active.id, cancelled.id, used.id], action: "rehabilitate" }),
            []
        );
        assert.equal(statusOf(active.id), "REFUNDED");
    });
}

test("la marca de reversión es durable: si no se puede escribir, la notificación falla (MP reintenta)", async () => {
    const sale = addConfirmedMpSale();
    addTicket({ saleId: sale.id });
    const originalCreate = prisma.developerAlertReversalEvent.create;
    prisma.developerAlertReversalEvent.create = async () => {
        throw new Error("DB_DOWN_SIMULATED");
    };
    const restore = mockMercadoPago(sale, "refunded");
    try {
        await assert.rejects(confirmMercadoPagoPaymentIfEligible({ paymentId: sale.mercadoPagoPaymentId, source: "WEBHOOK" }), /DB_DOWN_SIMULATED/);
    } finally {
        restore();
        prisma.developerAlertReversalEvent.create = originalCreate;
    }
});

// --- Scanner ----------------------------------------------------------------

const SCANNER = { id: "scanner-1", eventId: EVENT.id, name: "Puerta", gate: null };

test("scanner: REFUNDED y CANCELLED rechazados, USED como segundo ingreso rechazado, ACTIVE válido", async () => {
    const cases = [
        ["REFUNDED", "CANCELLED"],
        ["CANCELLED", "CANCELLED"],
        ["USED", "ALREADY_USED"],
        ["ACTIVE", "READY"],
    ];
    for (const [status, expected] of cases) {
        const t = addTicket({ status });
        const scan = await scanTicketService(SCANNER, { token: `${t.id}.${QR_SECRET}` });
        assert.equal(scan.status, expected, status);
        assert.equal(statusOf(t.id), status, "escanear nunca cambia el estado");
    }
});

test("scanner confirmar: REFUNDED / CANCELLED / USED nunca pasan a USED ni crean CheckIn", async () => {
    for (const [status, expected] of [["REFUNDED", "CANCELLED"], ["CANCELLED", "CANCELLED"], ["USED", "ALREADY_USED"]]) {
        const t = addTicket({ status });
        const checkInsBefore = db.checkIns.length;
        const result = await confirmScanService(SCANNER, { token: `${t.id}.${QR_SECRET}` });
        assert.equal(result.status, expected, status);
        assert.equal(statusOf(t.id), status);
        assert.equal(db.checkIns.length, checkInsBefore);
    }
});
