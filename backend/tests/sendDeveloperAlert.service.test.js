import test from "node:test";
import assert from "node:assert/strict";
import { sendDeveloperAlert, DeveloperAlertType } from "../src/services/email/sendDeveloperAlert.service.js";

// Alertas Developer — sólo las dos ramas que NUNCA tocan Resend ni Prisma
// (tipo desconocido / DEVELOPER_ALERT_EMAIL faltante): corren seguras bajo
// `npm run test:unit`, mismo criterio que serviceFee.service.test.js (el
// módulo importa prisma.js transitivamente para tryClaimDeveloperAlertCooldown,
// pero esa función nunca se llama acá, así que ninguna query se ejecuta).
// El resto de sendDeveloperAlert (envío real, tryClaimDeveloperAlertCooldown)
// necesita Resend/DB real — fuera de alcance de este archivo, ver el
// informe de entrega.

test("an unknown alert type returns sent:false without touching Resend or DEVELOPER_ALERT_EMAIL", async () => {
    const result = await sendDeveloperAlert("NOT_A_REAL_ALERT_TYPE", {});
    assert.equal(result.sent, false);
    assert.equal(result.reason, "unknown_alert_type");
});

test("a missing DEVELOPER_ALERT_EMAIL returns sent:false with a clear reason, and never throws", async () => {
    const original = process.env.DEVELOPER_ALERT_EMAIL;
    delete process.env.DEVELOPER_ALERT_EMAIL;
    try {
        const result = await sendDeveloperAlert(DeveloperAlertType.NEW_ORGANIZATION_PENDING, {
            organizationId: "org_test",
            name: "Test Org",
            status: "PENDING",
            createdAt: new Date(),
        });
        assert.equal(result.sent, false);
        assert.equal(result.reason, "developer_alert_email_not_configured");
    } finally {
        if (original === undefined) delete process.env.DEVELOPER_ALERT_EMAIL;
        else process.env.DEVELOPER_ALERT_EMAIL = original;
    }
});

test("an empty/whitespace-only DEVELOPER_ALERT_EMAIL is treated the same as missing", async () => {
    const original = process.env.DEVELOPER_ALERT_EMAIL;
    process.env.DEVELOPER_ALERT_EMAIL = "   ";
    try {
        const result = await sendDeveloperAlert(DeveloperAlertType.MERCADOPAGO_DISCONNECTED, {
            organizationId: "org_test",
            organizationName: "Test Org",
            connectionId: "conn_test",
            disconnectedAt: new Date(),
        });
        assert.equal(result.sent, false);
        assert.equal(result.reason, "developer_alert_email_not_configured");
    } finally {
        if (original === undefined) delete process.env.DEVELOPER_ALERT_EMAIL;
        else process.env.DEVELOPER_ALERT_EMAIL = original;
    }
});

test("DeveloperAlertType exposes exactly the 10 alert types documented in the delivery report", () => {
    const expected = [
        "NEW_ORGANIZATION_PENDING",
        "MERCADOPAGO_FIRST_CONNECTION",
        "MERCADOPAGO_DISCONNECTED",
        "FIRST_CONFIRMED_SALE",
        "FINANCIAL_INVARIANT_BROKEN",
        "HIGH_TICKET_PRICE",
        "HIGH_QUANTITY_SALE",
        "TOO_MANY_EVENTS",
        "SALES_VOLUME_SPIKE",
        "REFUNDS_VOLUME_SPIKE",
    ];
    assert.deepEqual(Object.keys(DeveloperAlertType).sort(), expected.sort());
});
