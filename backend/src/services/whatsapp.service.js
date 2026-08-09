// Fase 2A — sólo el webhook mínimo de Meta WhatsApp Cloud API (verificación
// GET + recepción POST). No conecta EventCreationEngine ni EventServicePort
// todavía: eso es una fase posterior, deliberadamente fuera de este archivo.

// Mismo criterio de validación LAZY que config/scannerSession.js: recién
// exige la variable de entorno al primer uso real (una llamada de Meta),
// no al arrancar el servidor — así el resto del backend sigue levantando
// aunque WHATSAPP_VERIFY_TOKEN todavía no esté configurada en Render.
let cachedVerifyToken;

export function getWhatsappVerifyToken() {
    if (cachedVerifyToken) return cachedVerifyToken;
    const value = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_VERIFY_TOKEN.");
    }
    cachedVerifyToken = value.trim();
    return cachedVerifyToken;
}

// Función pura (sin tocar process.env ni Express) para poder testearla
// directo, igual que buildBulkTicketActionPlan en ticketAdmin.service.js:
// recibe el token ya resuelto, nunca lo lee ella misma. Replica el
// mecanismo oficial de verificación de Meta: hub.mode debe ser "subscribe",
// hub.verify_token debe coincidir exactamente con el token configurado, y
// sólo entonces se devuelve hub.challenge tal cual para que Meta lo eco'ee.
export function evaluateWebhookVerification({ mode, token, challenge }, expectedToken) {
    if (mode === "subscribe" && typeof token === "string" && token === expectedToken && typeof challenge === "string" && challenge.length > 0) {
        return { verified: true, challenge };
    }
    return { verified: false };
}
