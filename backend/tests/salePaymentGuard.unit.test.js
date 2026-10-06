import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Regla inviolable: una venta paga jamás pasa a CONFIRMED (ni genera
// Tickets) sin evidencia de pago aprobado verificada server-side. Versión
// SIN base de datos: DATABASE_URL apunta a un puerto local cerrado ANTES de
// importar Prisma, y los modelos que usa cada camino se reemplazan por
// stubs en memoria. prisma.$transaction (único lugar donde se escribe
// CONFIRMED y se crean Tickets) se reemplaza por un centinela: si se
// alcanza, el guard autorizó; si no se llama, no pudo haberse creado nada.
// La API de Mercado Pago se simula con un fetch falso — nunca una llamada
// real ni un cargo real.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

const { default: prisma } = await import("../src/config/prisma.js");
const { confirmSaleService, assertSaleConfirmationAuthorized } = await import("../src/services/sale.service.js");
const { createVerifiedMercadoPagoPaymentEvidence, isTrustedPaymentEvidence } = await import("../src/services/paymentEvidence.js");
const { confirmMercadoPagoPaymentIfEligible } = await import("../src/services/mercadoPagoPaymentConfirmation.service.js");
const { encryptMercadoPagoSecret } = await import("../src/config/mercadoPagoEncryption.js");
const { default: app } = await import("../src/app.js");

const TX_REACHED = "TX_REACHED_SENTINEL";
let transactionCalls = 0;
const sales = new Map();
const ORGANIZER = { id: "org-owner-1", clerkId: "clerk_owner_1", role: "ORGANIZER" };
const CONNECTION = {
    id: "mpconn-1",
    organizationId: "org-1",
    mercadoPagoUserId: "999",
    status: "ACTIVE",
    accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    accessTokenEncrypted: encryptMercadoPagoSecret("APP_USR-test-token"),
};

prisma.$transaction = async () => {
    transactionCalls += 1;
    throw Object.assign(new Error(TX_REACHED), { code: TX_REACHED });
};
prisma.user.findUnique = async ({ where }) =>
    where.clerkId === ORGANIZER.clerkId || where.id === ORGANIZER.id ? { ...ORGANIZER } : null;
prisma.sale.findUnique = async ({ where }) => {
    const all = [...sales.values()];
    if (where.id !== undefined) return all.find((s) => s.id === where.id) ?? null;
    if (where.mercadoPagoPaymentId !== undefined) return all.find((s) => s.mercadoPagoPaymentId === where.mercadoPagoPaymentId) ?? null;
    if (where.mercadoPagoExternalReference !== undefined)
        return all.find((s) => s.mercadoPagoExternalReference === where.mercadoPagoExternalReference) ?? null;
    if (where.publicRecoveryToken !== undefined) return all.find((s) => s.publicRecoveryToken === where.publicRecoveryToken) ?? null;
    return null;
};
prisma.mercadoPagoConnection.findUnique = async ({ where }) => (where.id === CONNECTION.id ? { ...CONNECTION } : null);
prisma.mercadoPagoConnection.findFirst = async () => ({ ...CONNECTION });
for (const method of ["update", "updateMany", "create", "upsert"]) {
    prisma.sale[method] = async () => {
        throw new Error(`unexpected prisma.sale.${method} in unit test`);
    };
}
prisma.ticket.createMany = async () => {
    throw new Error("unexpected prisma.ticket.createMany outside a transaction");
};

let seq = 0;
function addSale(overrides = {}) {
    seq += 1;
    const sale = {
        id: `sale-${seq}`,
        status: "PENDING",
        origin: "SALE",
        paymentMethod: "MERCADO_PAGO",
        total: 3150,
        deletedAt: null,
        eventId: "event-1",
        functionId: "function-1",
        publicRecoveryToken: `token-${seq}`,
        mercadoPagoExternalReference: `extref-${seq}`,
        mercadoPagoPaymentId: null,
        items: [{ ticketTypeId: "tt-1", quantity: 1, ticketType: { name: "General" } }],
        event: { id: "event-1", organizationId: "org-1", organization: { id: "org-1", ownerId: ORGANIZER.id, closedAt: null, name: "Sala" } },
        function: { date: new Date(), venue: "Sala" },
        ...overrides,
    };
    sales.set(sale.id, sale);
    return sale;
}

function evidenceFor(sale, overrides = {}) {
    return createVerifiedMercadoPagoPaymentEvidence({
        paymentId: `pay-${sale.id}`,
        status: "approved",
        transactionAmount: Number(sale.total),
        currencyId: "ARS",
        source: "WEBHOOK",
        ...overrides,
    });
}

async function expectRejected(promise) {
    const before = transactionCalls;
    await assert.rejects(promise, (err) => err.code === "SALE_PAYMENT_NOT_VERIFIED");
    assert.equal(transactionCalls, before, "no debe abrirse la transacción que confirma y crea Tickets");
}

async function expectAuthorized(promise) {
    const before = transactionCalls;
    await assert.rejects(promise, (err) => err.code === TX_REACHED);
    assert.equal(transactionCalls, before + 1);
}

// --- confirmSaleService: venta paga ---------------------------------------

test("venta paga PENDING sin evidencia → SALE_PAYMENT_NOT_VERIFIED, sigue PENDING, 0 tickets", async () => {
    const sale = addSale();
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id));
    assert.equal(sales.get(sale.id).status, "PENDING");
});

test("venta MANUAL paga (flujo heredado) nunca se confirma, ni con evidencia de Mercado Pago", async () => {
    const sale = addSale({ paymentMethod: "MANUAL", mercadoPagoExternalReference: null });
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id));
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: evidenceFor(sale) }));
});

test("evidencia falsificada (objeto con los mismos campos, ej. armado desde req.body) → rechazada", async () => {
    const sale = addSale();
    const forged = {
        provider: "MERCADO_PAGO",
        paymentId: "pay-forged",
        status: "approved",
        transactionAmount: Number(sale.total),
        currencyId: "ARS",
        source: "WEBHOOK",
    };
    assert.equal(isTrustedPaymentEvidence(forged), false);
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: forged }));
    // Body "manipulado" pasado tal cual como options: status/paymentMethod/
    // origin/courtesyQuota de un request no autorizan nada.
    const body = JSON.parse(
        JSON.stringify({ status: "CONFIRMED", paymentMethod: "MANUAL", origin: "COURTESY", courtesyQuota: true, paymentEvidence: forged })
    );
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, body));
});

test("conocer publicRecoveryToken / saleToken / externalReference no confirma: no son evidencia", async () => {
    const sale = addSale();
    for (const value of [sale.publicRecoveryToken, sale.mercadoPagoExternalReference, sale.id]) {
        await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: value }));
        await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: { paymentId: value } }));
    }
});

test("evidencia verificada que no corresponde a ESTA venta → rechazada (monto, moneda, payment distinto)", async () => {
    const sale = addSale();
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: evidenceFor(sale, { transactionAmount: 1 }) }));
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: evidenceFor(sale, { currencyId: "USD" }) }));
    const linked = addSale({ mercadoPagoPaymentId: "pay-original" });
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, linked.id, { paymentEvidence: evidenceFor(linked, { paymentId: "pay-other" }) }));
});

test("la evidencia sólo se emite para un payment approved", () => {
    for (const status of ["pending", "in_process", "rejected", "cancelled", "refunded", "charged_back", undefined]) {
        assert.throws(() =>
            createVerifiedMercadoPagoPaymentEvidence({ paymentId: "p", status, transactionAmount: 1, currencyId: "ARS", source: "WEBHOOK" })
        );
    }
    assert.throws(() =>
        createVerifiedMercadoPagoPaymentEvidence({ paymentId: "p", status: "approved", transactionAmount: 1, currencyId: "ARS", source: "FRONTEND" })
    );
});

test("venta paga + evidencia verificada correspondiente → autorizada (llega a la transacción)", async () => {
    const sale = addSale();
    await expectAuthorized(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: evidenceFor(sale) }));
    for (const source of ["RECONCILIATION_AUTO", "RECONCILIATION_MANUAL", "BUYER_RECOVERY"]) {
        await expectAuthorized(confirmSaleService(ORGANIZER.clerkId, sale.id, { paymentEvidence: evidenceFor(sale, { source }) }));
    }
});

test("venta CONFIRMED histórica: sin evidencia no se re-procesa ni devuelve tickets; no se modifica", async () => {
    const sale = addSale({ status: "CONFIRMED", mercadoPagoPaymentId: "pay-hist" });
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, sale.id));
    assert.equal(sales.get(sale.id).status, "CONFIRMED");
    assert.equal(sales.get(sale.id).mercadoPagoPaymentId, "pay-hist");
});

// --- Cortesías --------------------------------------------------------------

test("cortesía por el mecanismo explícito (courtesyQuota) → autorizada", async () => {
    const courtesy = addSale({ origin: "COURTESY", paymentMethod: "MANUAL", mercadoPagoExternalReference: null });
    await expectAuthorized(confirmSaleService(ORGANIZER.clerkId, courtesy.id, { courtesyQuota: true, skipAutoEmail: true }));
});

test("cortesía sin el mecanismo explícito → rechazada; courtesyQuota no sirve para una venta paga", async () => {
    const courtesy = addSale({ origin: "COURTESY", paymentMethod: "MANUAL", mercadoPagoExternalReference: null });
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, courtesy.id));
    const paid = addSale();
    await expectRejected(confirmSaleService(ORGANIZER.clerkId, paid.id, { courtesyQuota: true }));
});

test("assertSaleConfirmationAuthorized: origin desconocido → rechazado", () => {
    assert.throws(() => assertSaleConfirmationAuthorized({ id: "x", origin: "OTHER", paymentMethod: "MANUAL", total: 0 }), {
        code: "SALE_PAYMENT_NOT_VERIFIED",
    });
});

// --- Mercado Pago: webhook / reconciliación / recuperación ------------------

function mockMercadoPagoPayment(payload) {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith("https://api.mercadopago.com/v1/payments/")) {
            return { ok: true, status: 200, json: async () => payload };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

function paymentPayload(sale, overrides = {}) {
    return {
        id: 555000 + seq,
        status: "approved",
        status_detail: "accredited",
        transaction_amount: Number(sale.total),
        currency_id: "ARS",
        external_reference: sale.mercadoPagoExternalReference,
        collector_id: 999,
        ...overrides,
    };
}

for (const source of ["WEBHOOK", "RECONCILIATION_AUTO", "RECONCILIATION_MANUAL", "BUYER_RECOVERY"]) {
    test(`Mercado Pago ${source}: payment approved verificado → confirmSaleService autoriza (camino legítimo intacto)`, async () => {
        const sale = addSale();
        const payload = paymentPayload(sale);
        const restore = mockMercadoPagoPayment(payload);
        try {
            await expectAuthorized(
                confirmMercadoPagoPaymentIfEligible({ paymentId: payload.id, candidateConnectionId: CONNECTION.id, source })
            );
        } finally {
            restore();
        }
    });
}

test("Mercado Pago: payment no aprobado / monto distinto / otro collector → no confirma, 0 tickets", async () => {
    const cases = [
        [{ status: "pending" }, "not_approved"],
        [{ status: "in_process" }, "not_approved"],
        [{ status: "rejected" }, "payment_attempt_failed"],
        [{ transaction_amount: 1 }, "unresolvable"],
        [{ currency_id: "USD" }, "unresolvable"],
        [{ collector_id: 123 }, "unresolvable"],
    ];
    for (const [overrides, action] of cases) {
        const sale = addSale();
        const payload = paymentPayload(sale, overrides);
        const restore = mockMercadoPagoPayment(payload);
        const before = transactionCalls;
        try {
            const outcome = await confirmMercadoPagoPaymentIfEligible({ paymentId: payload.id, candidateConnectionId: CONNECTION.id, source: "WEBHOOK" });
            assert.equal(outcome.action, action, JSON.stringify(overrides));
            assert.equal(transactionCalls, before);
            assert.equal(sales.get(sale.id).status, "PENDING");
        } finally {
            restore();
        }
    }
});

test("Mercado Pago: webhook repetido sobre una venta ya CONFIRMED → already_confirmed, sin nueva transacción (sin duplicar tickets)", async () => {
    const sale = addSale({ status: "CONFIRMED" });
    const payload = paymentPayload(sale);
    const restore = mockMercadoPagoPayment(payload);
    const before = transactionCalls;
    try {
        for (let i = 0; i < 3; i += 1) {
            const outcome = await confirmMercadoPagoPaymentIfEligible({ paymentId: payload.id, candidateConnectionId: CONNECTION.id, source: "WEBHOOK" });
            assert.equal(outcome.action, "already_confirmed");
        }
        assert.equal(transactionCalls, before);
    } finally {
        restore();
    }
});

// --- HTTP: endpoints heredados eliminados -----------------------------------

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");
let server;
let baseUrl;

test.before(async () => {
    const harness = express();
    harness.use((req, res, next) => {
        const clerkId = req.headers["x-test-clerk-id"] || null;
        req.auth = Object.assign(
            () => ({ userId: clerkId, tokenType: "session_token", isAuthenticated: Boolean(clerkId) }),
            { [CLERK_AUTH_BRAND]: true }
        );
        next();
    });
    harness.use(app);
    await new Promise((resolve) => {
        server = harness.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

test("POST /api/sales, /:token/confirm-by-buyer y /:id/confirm → 404 (eliminados), sin abrir transacción", async () => {
    const sale = addSale();
    const before = transactionCalls;
    const body = JSON.stringify({ status: "CONFIRMED", paymentMethod: "MANUAL", eventId: "event-1", items: [] });
    const calls = [
        ["/api/sales", {}],
        [`/api/sales/${sale.publicRecoveryToken}/confirm-by-buyer`, {}],
        [`/api/sales/${sale.id}/confirm`, { "x-test-clerk-id": ORGANIZER.clerkId }],
    ];
    for (const [path, headers] of calls) {
        const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
        assert.equal(res.status, 404, path);
    }
    assert.equal(transactionCalls, before);
    assert.equal(sales.get(sale.id).status, "PENDING");
});
