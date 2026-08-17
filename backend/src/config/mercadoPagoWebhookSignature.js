import crypto from "node:crypto";

// MP-3 — validación de autenticidad de webhooks de Mercado Pago. Verificado
// contra la documentación oficial vigente (developers.mercadopago.com,
// "Notificaciones Webhooks" / "Validar el origen de las notificaciones"),
// corroborado además contra el propio código público de los SDKs oficiales
// (WebhookSignatureValidator) donde la documentación en prosa no alcanzaba
// a mostrar el algoritmo completo:
//
//   - Mercado Pago manda el header `x-signature` con la forma
//     "ts=<epoch_ms>,v1=<hmac_hex>" — se parsea por "," y cada parte por
//     "clave=valor".
//   - El "manifest" (mensaje que se firma) se arma como:
//       id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;
//     Si data.id o x-request-id no vienen, esa parte se OMITE del
//     manifest entero (nunca se deja un "id:;" vacío).
//   - data.id sale del QUERY STRING de la URL que Mercado Pago llama
//     (?data.id=...), no del body — así lo muestra el propio ejemplo
//     oficial del validador (`dataId: req.query['data.id']`).
//   - Firma = HMAC-SHA256(manifest, secret), en hexadecimal.
//   - Comparación: debe ser criptográficamente segura (tiempo constante),
//     nunca con `===` sobre strings.
//
// El secreto ("clave secreta") se obtiene en el panel de Mercado Pago
// Developers: Tus integraciones -> la aplicación -> Webhooks -> Configurar
// notificación -> revelar la clave generada. No caduca, se recomienda (no
// se exige) rotarla periódicamente.
//
// Nota de diseño: el manifest firmado NUNCA cubre el resto del body de la
// notificación (type/action/user_id/live_mode, etc.) — sólo data.id +
// x-request-id + ts. Por eso mercadoPagoWebhook.service.js nunca confía en
// esos otros campos como autorización, sólo como pistas de enrutamiento
// (ver el informe de entrega de MP-3, sección "Credencial OAuth utilizada").

let cachedSecret;
export function getMercadoPagoWebhookSecret() {
    if (cachedSecret) return cachedSecret;
    const value = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno MERCADOPAGO_WEBHOOK_SECRET.");
    }
    cachedSecret = value.trim();
    return cachedSecret;
}

function parseXSignatureHeader(xSignatureHeader) {
    if (!xSignatureHeader || typeof xSignatureHeader !== "string") return null;

    const parts = {};
    for (const chunk of xSignatureHeader.split(",")) {
        const separatorIndex = chunk.indexOf("=");
        if (separatorIndex === -1) continue;
        const key = chunk.slice(0, separatorIndex).trim();
        const value = chunk.slice(separatorIndex + 1).trim();
        if (key) parts[key] = value;
    }

    if (!parts.ts || !parts.v1) return null;
    return { ts: parts.ts, v1: parts.v1 };
}

function buildManifest({ dataId, requestId, ts }) {
    let manifest = "";
    if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    return manifest;
}

// Devuelve SIEMPRE un boolean — nunca lanza por un header ausente o mal
// formado, eso también es "firma inválida". `secret` se recibe ya resuelto
// (el caller decide qué hacer si getMercadoPagoWebhookSecret() lanza por
// falta de configuración — eso es un error de config, no una firma
// inválida, y se maneja aparte en el controller).
export function verifyMercadoPagoWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
    const parsed = parseXSignatureHeader(xSignature);
    if (!parsed) return false;
    if (!secret) return false;

    const manifest = buildManifest({ dataId, requestId: xRequestId, ts: parsed.ts });
    const expectedHex = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

    let expectedBuffer;
    let actualBuffer;
    try {
        expectedBuffer = Buffer.from(expectedHex, "hex");
        actualBuffer = Buffer.from(parsed.v1, "hex");
    } catch {
        return false;
    }
    if (expectedBuffer.length === 0 || expectedBuffer.length !== actualBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
