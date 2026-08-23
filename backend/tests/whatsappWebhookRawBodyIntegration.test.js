import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app from "../src/app.js";

// Auditoría "webhook de WhatsApp deja de llegar al chatbot" — a diferencia
// de whatsappWebhookSignature.test.js/whatsapp.webhook.test.js (que
// construyen un `req` FAKE con `body` y `rawBody` derivados del MISMO
// JSON.stringify, así que nunca pueden distinguir "usa los bytes crudos
// reales" de "usa JSON.stringify(req.body) por accidente" — ambos caminos
// producen el mismo resultado en esos tests), este archivo levanta la app
// Express REAL (`app.listen`) y le manda un POST HTTP real, con el body
// como Buffer crudo tal cual — igual que Meta. Es la única forma de
// probar de verdad que app.js#express.json({verify}) captura req.rawBody
// ANTES de cualquier parseo/reserialización.
//
// Seguro de correr sin DB: el payload es un webhook de STATUS (sin
// `value.messages`) — parseInboundWhatsappMessages siempre devuelve []
// para eso (ver whatsapp.service.js), así que
// processInboundMessages([], ...) nunca llama a processInboundMessage ni
// toca Prisma (Promise.allSettled sobre un array vacío). No requiere
// hasDatabase/testWithDb ni tests/helpers/dbGuard.js — nunca ejercita ese
// camino.

process.env.WHATSAPP_APP_SECRET = "test-real-http-app-secret";

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

// Payload de status update — deliberadamente con indentación/espacios
// "bonitos" (Buffer.from(JSON.stringify(payload, null, 2))), MUY distinto
// byte a byte de la forma compacta que produciría un
// JSON.parse(...) + JSON.stringify(...) posterior. Si el servidor alguna
// vez usara req.body re-serializado en vez de los bytes crudos reales, la
// firma calculada acá (sobre esos bytes exactos) dejaría de coincidir.
function buildStatusPayload() {
    return { entry: [{ id: "1", changes: [{ value: { statuses: [{ id: "wamid.STATUS", status: "read" }] }, field: "messages" }] }] };
}

function realSignatureFor(rawBody, secret) {
    return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

async function postWebhook({ body, signature }) {
    const headers = { "Content-Type": "application/json" };
    if (signature !== undefined) headers["X-Hub-Signature-256"] = signature;
    return fetch(`${baseUrl}/api/whatsapp/webhook`, { method: "POST", headers, body });
}

// A) raw body + firma correcta (calculada sobre esos MISMOS bytes) -> 200.
test("real HTTP: a pretty-printed raw body with a signature computed over those exact bytes is accepted (200)", async () => {
    const rawBody = Buffer.from(JSON.stringify(buildStatusPayload(), null, 2));
    const response = await postWebhook({ body: rawBody, signature: realSignatureFor(rawBody, process.env.WHATSAPP_APP_SECRET) });
    assert.equal(response.status, 200);
});

// B/H) misma información, pero la firma se calculó sobre la reserialización
// COMPACTA (JSON.stringify sin indentar) — bytes DISTINTOS de los que
// realmente se mandan. Si el servidor derivara la firma de
// JSON.stringify(req.body) en vez de los bytes crudos, esto pasaría por
// error; con los bytes crudos reales, debe rechazarse.
test("real HTTP: a signature computed over a re-serialized (compact) version of the same JSON is rejected (401) — proves the server never re-derives the signature from JSON.stringify(req.body)", async () => {
    const payload = buildStatusPayload();
    const prettyRawBody = Buffer.from(JSON.stringify(payload, null, 2));
    const compactReserialized = Buffer.from(JSON.stringify(payload));
    assert.notDeepEqual(prettyRawBody, compactReserialized, "la pre-condición del test requiere que los bytes sean distintos");

    const response = await postWebhook({ body: prettyRawBody, signature: realSignatureFor(compactReserialized, process.env.WHATSAPP_APP_SECRET) });
    assert.equal(response.status, 401);
});

// C) firma incorrecta (body real alterado DESPUÉS de calcular la firma
// vieja, pero todavía JSON válido — un byte roto haría que express.json()
// lo rechace con 500 por sintaxis inválida ANTES de llegar a nuestro
// chequeo de firma, que es un escenario distinto al que este test quiere
// probar) -> 401.
test("real HTTP: a tampered (but still valid-JSON) body with a stale signature is rejected (401)", async () => {
    const original = buildStatusPayload();
    const rawBody = Buffer.from(JSON.stringify(original, null, 2));
    const staleSignature = realSignatureFor(rawBody, process.env.WHATSAPP_APP_SECRET);

    const tamperedPayload = buildStatusPayload();
    tamperedPayload.entry[0].changes[0].value.statuses[0].status = "sent"; // "read" -> "sent"
    const tamperedRawBody = Buffer.from(JSON.stringify(tamperedPayload, null, 2));
    assert.notDeepEqual(tamperedRawBody, rawBody, "la pre-condición del test requiere que los bytes realmente cambien");

    const response = await postWebhook({ body: tamperedRawBody, signature: staleSignature });
    assert.equal(response.status, 401);
});

// D) header ausente -> 401.
test("real HTTP: no X-Hub-Signature-256 header at all is rejected (401)", async () => {
    const rawBody = Buffer.from(JSON.stringify(buildStatusPayload(), null, 2));
    const response = await postWebhook({ body: rawBody });
    assert.equal(response.status, 401);
});

// G) el handshake GET sigue funcionando (real HTTP, mismo server real).
test("real HTTP: GET handshake with the correct hub.verify_token still echoes hub.challenge (200)", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "test-real-http-verify-token";
    const url = `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-real-http-verify-token&hub.challenge=echo-me-123`;
    const response = await fetch(url);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text, "echo-me-123");
});

test("real HTTP: GET handshake with the wrong hub.verify_token is rejected (403)", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "test-real-http-verify-token";
    const url = `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=echo-me-123`;
    const response = await fetch(url);
    assert.equal(response.status, 403);
});
