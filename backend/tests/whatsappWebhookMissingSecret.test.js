import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app from "../src/app.js";

// E) WHATSAPP_APP_SECRET ausente -> rechazado (fail-closed), sobre el
// pipeline HTTP real. Deliberadamente en su PROPIO archivo: getWhatsappAppSecret
// cachea el valor en memoria de módulo apenas se lee con éxito una vez (ver
// whatsapp.service.js), así que este escenario ("nunca se configuró")
// necesita que WHATSAPP_APP_SECRET esté ausente ANTES de la primera
// request de todo el proceso — no se puede probar de forma confiable
// compartiendo proceso con otro archivo que sí llega a setearla/cachearla.
delete process.env.WHATSAPP_APP_SECRET;

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test("real HTTP: with WHATSAPP_APP_SECRET never configured, a webhook POST is rejected (401) even with a well-formed signature header — fail-closed, never processed", async () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: "1", changes: [{ value: { statuses: [{ id: "wamid.X", status: "read" }] } }] }] }));
    // Firma con CUALQUIER secreto — no importa cuál, porque el servidor
    // debe rechazar por falta de configuración ANTES de siquiera comparar.
    const signature = `sha256=${crypto.createHmac("sha256", "whatever-secret").update(rawBody).digest("hex")}`;

    const response = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
        body: rawBody,
    });

    assert.equal(response.status, 401);
});
