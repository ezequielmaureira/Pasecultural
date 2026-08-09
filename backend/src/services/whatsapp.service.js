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
