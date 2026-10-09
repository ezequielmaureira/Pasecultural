import test from "node:test";
import assert from "node:assert/strict";
import { buildCorsOptions } from "../src/config/corsOptions.js";
import { rateLimit } from "../src/middlewares/rateLimit.js";

function corsDecision(options, origin) {
    return new Promise((resolve) => options.origin(origin, (err, allowed) => resolve(allowed)));
}

test("CORS-A: sin CORS_ALLOWED_ORIGINS se mantiene el comportamiento histórico (cualquier origen)", () => {
    assert.deepEqual(buildCorsOptions({}), {});
    assert.deepEqual(buildCorsOptions({ CORS_ALLOWED_ORIGINS: " , " }), {});
});

test("CORS-B: con lista, sólo esos orígenes; requests sin Origin (webhooks) siempre pasan", async () => {
    const options = buildCorsOptions({ CORS_ALLOWED_ORIGINS: "https://www.smarticket.com.ar, https://smarticket.com.ar/" });
    assert.equal(await corsDecision(options, "https://www.smarticket.com.ar"), true);
    assert.equal(await corsDecision(options, "https://smarticket.com.ar"), true);
    assert.equal(await corsDecision(options, "https://evil.example.com"), false);
    assert.equal(await corsDecision(options, "https://www.smarticket.com.ar.evil.com"), false);
    assert.equal(await corsDecision(options, undefined), true);
});

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => ((res.statusCode = code), res);
    res.json = (body) => ((res.body = body), res);
    return res;
}

test("RL-A: el límite corta en max y es independiente por IP y por endpoint", () => {
    const limiterA = rateLimit({ windowMs: 60000, max: 2 });
    const limiterB = rateLimit({ windowMs: 60000, max: 2 });
    let passed = 0;
    const next = () => passed++;
    for (let i = 0; i < 3; i++) limiterA({ ip: "1.1.1.1" }, fakeRes(), next);
    assert.equal(passed, 2);
    const blocked = fakeRes();
    limiterA({ ip: "1.1.1.1" }, blocked, next);
    assert.equal(blocked.statusCode, 429);
    limiterA({ ip: "2.2.2.2" }, fakeRes(), next);
    limiterB({ ip: "1.1.1.1" }, fakeRes(), next);
    assert.equal(passed, 4);
});

import { getReconciliationAlertEmail } from "../src/config/resend.js";

test("ALERT-A: sin MERCADOPAGO_RECONCILIATION_ALERT_EMAIL, las alertas de conciliación van a DEVELOPER_ALERT_EMAIL", () => {
    assert.equal(getReconciliationAlertEmail({ MERCADOPAGO_RECONCILIATION_ALERT_EMAIL: "conc@x.test", DEVELOPER_ALERT_EMAIL: "dev@x.test" }), "conc@x.test");
    assert.equal(getReconciliationAlertEmail({ DEVELOPER_ALERT_EMAIL: "dev@x.test" }), "dev@x.test");
    assert.equal(getReconciliationAlertEmail({ MERCADOPAGO_RECONCILIATION_ALERT_EMAIL: "  ", DEVELOPER_ALERT_EMAIL: "dev@x.test" }), "dev@x.test");
});

import express from "express";
import cors from "cors";

// Con el paquete `cors` real (el mismo de app.js), sobre un servidor local:
// preflight OPTIONS, origen permitido, origen ajeno y request sin Origin
// (webhooks de Mercado Pago/WhatsApp, health check de Fly).
test("CORS-C: con la lista recomendada, el comportamiento HTTP real es el esperado", async () => {
    const app = express();
    app.use(cors(buildCorsOptions({ CORS_ALLOWED_ORIGINS: "https://www.smarticket.com.ar,https://pasecultural.smarticket.com.ar" })));
    app.post("/webhook", (req, res) => res.status(200).json({ ok: true }));
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const preflight = (origin) =>
            fetch(`${base}/webhook`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });

        const okPre = await preflight("https://www.smarticket.com.ar");
        assert.equal(okPre.status, 204);
        assert.equal(okPre.headers.get("access-control-allow-origin"), "https://www.smarticket.com.ar");
        assert.match(okPre.headers.get("access-control-allow-headers") ?? "", /authorization/i);

        const pcPre = await preflight("https://pasecultural.smarticket.com.ar");
        assert.equal(pcPre.headers.get("access-control-allow-origin"), "https://pasecultural.smarticket.com.ar");

        const evilPre = await preflight("https://evil.example.com");
        assert.equal(evilPre.headers.get("access-control-allow-origin"), null, "el navegador bloquea un origen ajeno");

        const noOrigin = await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        assert.equal(noOrigin.status, 200, "server-to-server (sin Origin) nunca se bloquea");
    } finally {
        server.close();
    }
});

import { redactPath } from "../src/logging/redactPath.js";

test("LOG-A: la ruta logueada nunca lleva tokens del path ni query string; los ids técnicos quedan", () => {
    const token = "Ab3dEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"; // 43 chars, como publicRecoveryToken
    assert.equal(redactPath(`/api/sales/${token}/status`), "/api/sales/[redacted]/status");
    assert.equal(redactPath(`/api/sales/${token}/pdf?x=1`), "/api/sales/[redacted]/pdf");
    assert.equal(redactPath("/api/events/cmuvj87y20022oiho7deu62af/functions?token=abc"), "/api/events/cmuvj87y20022oiho7deu62af/functions");
    assert.equal(redactPath(undefined), "");
});
