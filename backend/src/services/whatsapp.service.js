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

// Fase 2B — parseo del POST del webhook. Sigue sin conocer
// EventCreationEngine/EventServicePort/Prisma: sólo transforma el payload
// de Meta en mensajes normalizados, en memoria, sin ningún efecto lateral.

function toNullableString(value) {
    return typeof value === "string" ? value : null;
}

// contacts[] no viene necesariamente alineado con messages[] (puede haber
// más de un contacto en el mismo `value`, o ninguno) — la única asociación
// segura que documenta Meta es wa_id === message.from, nunca la posición.
function findProfileName(contacts, from) {
    if (!Array.isArray(contacts) || !from) return null;
    const match = contacts.find((contact) => contact?.wa_id === from);
    return toNullableString(match?.profile?.name);
}

// `value` es el mismo `changes[].value` que contiene tanto `messages` como
// `contacts`/`metadata` — se pasa completo para poder resolver profileName/
// phoneNumberId sin que el caller tenga que desarmarlo dos veces.
function normalizeMessage(message, value) {
    const from = toNullableString(message?.from);
    const type = toNullableString(message?.type);

    return {
        messageId: toNullableString(message?.id),
        from,
        type,
        timestamp: toNullableString(message?.timestamp),
        // Sólo se lee text.body cuando type==="text" — cualquier otro tipo
        // (image/audio/video/document/location/contacts/interactive/button/
        // reaction/sticker/lo que Meta agregue después) queda en null acá a
        // propósito: reconocer esos tipos es de una fase posterior, pero no
        // deben romper el parseo ni perderse del array resultante.
        text: type === "text" ? toNullableString(message?.text?.body) : null,
        profileName: findProfileName(value?.contacts, from),
        phoneNumberId: toNullableString(value?.metadata?.phone_number_id),
    };
}

// ==================================================================
// Envío — Fase 2C. Sigue sin conocer EventCreationEngine/EventServicePort:
// esto es sólo "cómo mandar un mensaje por WhatsApp", nada de cuándo/por
// qué mandarlo (eso lo decide quien llame a estas funciones, en una fase
// posterior).
// ==================================================================

const GRAPH_API_TIMEOUT_MS = 10000;

// Mismo criterio LAZY que getWhatsappVerifyToken/config/scannerSession.js:
// recién exige la variable al primer envío real, nunca al arrancar. Tres
// variables independientes (no una sola "config" empaquetada) para poder
// reportar cuál falta exactamente.
let cachedAccessToken;
function getWhatsappAccessToken() {
    if (cachedAccessToken) return cachedAccessToken;
    const value = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_ACCESS_TOKEN.");
    }
    cachedAccessToken = value.trim();
    return cachedAccessToken;
}

let cachedPhoneNumberId;
function getWhatsappPhoneNumberId() {
    if (cachedPhoneNumberId) return cachedPhoneNumberId;
    const value = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_PHONE_NUMBER_ID.");
    }
    cachedPhoneNumberId = value.trim();
    return cachedPhoneNumberId;
}

let cachedGraphApiVersion;
function getWhatsappGraphApiVersion() {
    if (cachedGraphApiVersion) return cachedGraphApiVersion;
    const value = process.env.WHATSAPP_GRAPH_API_VERSION;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_GRAPH_API_VERSION.");
    }
    cachedGraphApiVersion = value.trim();
    return cachedGraphApiVersion;
}

// POST https://graph.facebook.com/{VERSION}/{PHONE_NUMBER_ID}/messages —
// única función que efectivamente llama a Meta. Usa el `fetch` global de
// Node (18+, ya disponible acá) — no agrega ninguna dependencia HTTP nueva.
// Nunca lanza por un rechazo de Meta ni por timeout/red: siempre devuelve
// {success, messageId, error}, así el caller no necesita un try/catch
// distinto para cada motivo de falla. Sí puede lanzar (Error simple, sin
// AppError — igual que scannerSession.js#getSecret) si falta configurar
// alguna de las 3 variables de entorno, porque eso es un error de
// configuración, no una respuesta de Meta.
async function postToGraphApi(body) {
    const url = `https://graph.facebook.com/${getWhatsappGraphApiVersion()}/${getWhatsappPhoneNumberId()}/messages`;
    const accessToken = getWhatsappAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        // Nunca se loguea acá — el caller decide qué loguear (nunca el
        // token/teléfono/texto, ver whatsapp.controller.js/devTools.controller.js).
        return { success: false, messageId: null, error: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
    } finally {
        clearTimeout(timeoutId);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        // Meta devuelve {error:{message,type,code,...}} en el body — se
        // conserva sólo el mensaje, nunca el payload completo (podría
        // repetir datos del destinatario).
        return { success: false, messageId: null, error: payload?.error?.message ?? `HTTP_${response.status}` };
    }

    return { success: true, messageId: payload?.messages?.[0]?.id ?? null, error: null };
}

// Mensaje de texto libre — sujeto a la ventana de 24hs de WhatsApp (sólo se
// puede mandar texto libre si el destinatario escribió primero dentro de
// las últimas 24hs). Si Meta lo rechaza por esa restricción, esta función
// NO reintenta ni cambia de estrategia sola: devuelve {success:false,
// error} tal cual lo reportó Meta, para que el caller lo muestre claro.
export async function sendWhatsappTextMessage({ to, text }) {
    return postToGraphApi({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
    });
}

// hello_world — el único template ya probado desde el panel de Meta (ver
// contexto de esta fase). No crea templates nuevos: dispara exactamente
// ese, con el mismo mecanismo de envío que sendWhatsappTextMessage.
export async function sendWhatsappHelloWorldTemplate({ to }) {
    return postToGraphApi({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } },
    });
}

// Navega entry[] → changes[] → value → messages[] de forma completamente
// defensiva: cualquier nivel ausente, vacío o con otra forma (ej. un
// webhook de status: value.statuses en vez de value.messages) simplemente
// no aporta mensajes, nunca lanza. Nunca asume `contacts[0]` — ver
// findProfileName. `messageId` se conserva siempre que exista: es la clave
// que una fase futura va a usar para deduplicar reintentos de Meta, pero
// esta función no deduplica nada por sí misma.
export function parseInboundWhatsappMessages(body) {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    const messages = [];

    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value;
            const valueMessages = Array.isArray(value?.messages) ? value.messages : [];
            for (const message of valueMessages) {
                messages.push(normalizeMessage(message, value));
            }
        }
    }

    return messages;
}
