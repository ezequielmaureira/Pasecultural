import crypto from "node:crypto";

// Validación de autenticidad del webhook de WhatsApp/Meta — auditoría
// (ronda "Verificación de teléfono de Organizaciones"): el POST
// /api/whatsapp/webhook NO tenía ninguna verificación criptográfica del
// origen (sólo hub.verify_token en el handshake GET de configuración
// inicial, que nunca protege los eventos reales). Dado que la regla
// central de este bloque es "la confirmación de teléfono SÓLO puede venir
// del webhook legítimo de Meta", se agrega acá la validación real,
// reutilizada por CUALQUIER caller del webhook (no sólo la verificación de
// teléfono) — nunca se debilita nada existente, sólo se agrega esta capa.
//
// Formato oficial de Meta (Graph API webhooks, documentado en "Webhooks
// Getting Started" / "Validating Payloads"): header `X-Hub-Signature-256:
// sha256=<hex>`, calculado como HMAC-SHA256(rawBody, app_secret) sobre los
// bytes CRUDOS del body tal cual los mandó Meta — nunca sobre el JSON ya
// parseado/re-serializado (un re-serializado puede diferir en espacios/
// orden de claves y no matchear la firma real). Por eso app.js captura
// req.rawBody en el `verify` de express.json(), y este módulo firma
// exactamente esos bytes.
let cachedAppSecret;
export function getWhatsappAppSecret() {
    if (cachedAppSecret) return cachedAppSecret;
    const value = process.env.WHATSAPP_APP_SECRET;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_APP_SECRET.");
    }
    cachedAppSecret = value.trim();
    return cachedAppSecret;
}

export function parseXHubSignatureHeader(header) {
    if (!header || typeof header !== "string") return null;
    const [algo, hex] = header.split("=");
    if (algo !== "sha256" || !hex) return null;
    return hex;
}

// Devuelve SIEMPRE un boolean — nunca lanza por un header ausente/mal
// formado o un rawBody ausente, eso también es "firma inválida". `secret`
// se recibe ya resuelto (el caller decide qué hacer si
// getWhatsappAppSecret() lanza por falta de configuración — error de
// config, no firma inválida, ver whatsapp.controller.js).
export function verifyWhatsappWebhookSignature({ signatureHeader, rawBody, secret }) {
    const providedHex = parseXHubSignatureHeader(signatureHeader);
    if (!providedHex || !secret || !rawBody) return false;

    const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    let expectedBuffer;
    let providedBuffer;
    try {
        expectedBuffer = Buffer.from(expectedHex, "hex");
        providedBuffer = Buffer.from(providedHex, "hex");
    } catch {
        return false;
    }
    if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
