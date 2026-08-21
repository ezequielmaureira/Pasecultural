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
// Bug fix (carga de imagen del evento) — hasta acá, un mensaje type==="image"
// perdía TODOS sus datos propios (id de media, mime_type, sha256, caption):
// normalizeMessage sólo sabía leer `text.body`. `image.id` es lo único
// imprescindible para el paso siguiente (Meta Media API); mime_type/sha256/
// caption se conservan también porque Meta ya los manda gratis en el mismo
// webhook y sirven de primera validación barata antes de gastar una llamada
// a la Media API (ver whatsappMediaUpload.service.js) — nunca se usan como
// única fuente de verdad, el mime_type/tamaño reales siempre se revalidan
// contra lo que Meta devuelve en la Media API y contra los bytes descargados.
function normalizeImage(message) {
    const image = message?.image;
    if (!image?.id) return null;
    return {
        id: toNullableString(image.id),
        mimeType: toNullableString(image.mime_type),
        sha256: toNullableString(image.sha256),
        caption: toNullableString(image.caption),
    };
}

// Bug fix (ubicación por WhatsApp Location) — contrato ESTABLE y documentado
// de la WhatsApp Business Cloud API para un mensaje entrante type==="location":
// siempre `latitude`/`longitude` (número); `name`/`address` sólo cuando el
// usuario compartió un LUGAR buscado (no una ubicación en vivo) — Meta nunca
// entrega ciudad/provincia por separado, ni acá ni en ningún otro campo del
// mensaje. Se validan explícitamente como `number` (nunca se asume el tipo
// del payload) y se descarta el mensaje (`null`) si falta cualquiera de las
// dos coordenadas — sin lat/lng no hay "ubicación" posible.
function normalizeLocation(message) {
    const location = message?.location;
    if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") return null;
    return {
        latitude: location.latitude,
        longitude: location.longitude,
        name: toNullableString(location.name),
        address: toNullableString(location.address),
    };
}

function normalizeMessage(message, value) {
    const from = toNullableString(message?.from);
    const type = toNullableString(message?.type);

    return {
        messageId: toNullableString(message?.id),
        from,
        type,
        timestamp: toNullableString(message?.timestamp),
        // Sólo se lee text.body cuando type==="text" — cualquier otro tipo
        // (audio/video/document/contacts/interactive/button/reaction/
        // sticker/lo que Meta agregue después) queda en null acá a
        // propósito: reconocer esos tipos es de una fase posterior, pero no
        // deben romper el parseo ni perderse del array resultante.
        text: type === "text" ? toNullableString(message?.text?.body) : null,
        // Sólo se lee/arma cuando type==="image" — cualquier otro tipo queda
        // en null, mismo criterio que `text` de arriba.
        image: type === "image" ? normalizeImage(message) : null,
        // Idem para type==="location".
        location: type === "location" ? normalizeLocation(message) : null,
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

// ==================================================================
// Meta Media API — bug fix (carga de imagen del evento). Reusa EXACTAMENTE
// la misma configuración Meta que el resto de este archivo
// (getWhatsappGraphApiVersion/getWhatsappAccessToken, ya lazy-cacheadas más
// arriba) — no se agrega ninguna variable de entorno nueva ni se hardcodea
// una versión de Graph API distinta a WHATSAPP_GRAPH_API_VERSION.
// ==================================================================

// GET /{version}/{mediaId} — primer paso obligatorio de Meta para leer un
// media entrante: NUNCA se puede descargar directo con sólo el id, hay que
// pedirle antes esta URL temporal autorizada (que además exige el mismo
// Bearer token para poder usarse, ver downloadWhatsappMedia). mime_type/
// file_size acá son los que Meta confirma del lado servidor — más
// confiables que los que ya vinieron en el webhook (ver normalizeImage).
export async function fetchWhatsappMediaMetadata(mediaId) {
    const url = `https://graph.facebook.com/${getWhatsappGraphApiVersion()}/${mediaId}`;
    const accessToken = getWhatsappAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
        });
    } catch (error) {
        return { success: false, url: null, mimeType: null, fileSize: null, error: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
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
        return { success: false, url: null, mimeType: null, fileSize: null, error: payload?.error?.message ?? `HTTP_${response.status}` };
    }

    return {
        success: true,
        url: toNullableString(payload?.url),
        mimeType: toNullableString(payload?.mime_type),
        fileSize: typeof payload?.file_size === "number" ? payload.file_size : null,
        error: null,
    };
}

// Descarga los bytes reales desde la URL temporal que devolvió
// fetchWhatsappMediaMetadata. Esa URL, aunque tiene forma de link normal,
// NO es pública — Meta exige el mismo Bearer token para poder bajarla (así
// lo documenta la Cloud API). El token viaja únicamente en este header, de
// este único fetch: nunca se persiste ni se devuelve en el resultado.
export async function downloadWhatsappMedia(mediaUrl) {
    const accessToken = getWhatsappAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(mediaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
        });
    } catch (error) {
        return { success: false, buffer: null, contentType: null, error: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok) {
        return { success: false, buffer: null, contentType: null, error: `HTTP_${response.status}` };
    }

    let buffer;
    try {
        buffer = Buffer.from(await response.arrayBuffer());
    } catch {
        return { success: false, buffer: null, contentType: null, error: "INVALID_BODY" };
    }

    return { success: true, buffer, contentType: response.headers.get("content-type"), error: null };
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

// ==================================================================
// Envío de template GENÉRICO — Fase "cambio de número de WhatsApp".
// sendWhatsappTextMessage (más arriba) SÓLO funciona dentro de la ventana
// de 24hs de WhatsApp, contada desde el ÚLTIMO mensaje que esa persona le
// mandó a este número de negocio. Un número que nunca escribió antes (el
// caso real del código OTP hacia un WhatsApp NUEVO, y el mensaje de
// bienvenida inmediatamente después) NUNCA tiene esa ventana abierta —
// cualquier mensaje ahí es "iniciado por el negocio" y Meta lo RECHAZA
// salvo que sea un message template ya aprobado. Esta función es la única
// forma genérica de mandar un template con variables reales en el cuerpo
// (a diferencia de sendWhatsappHelloWorldTemplate, que no tiene ninguna);
// nunca asume que un template con determinado nombre existe/está aprobado
// — eso lo valida Meta en el momento del envío, y esta función nunca
// oculta ese rechazo (ver postToGraphApi, que ya no lanza por un rechazo
// de Meta, sólo devuelve {success:false, error}).
export async function sendWhatsappTemplateMessage({ to, templateName, languageCode, bodyParameters = [] }) {
    return postToGraphApi({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
            name: templateName,
            language: { code: languageCode },
            // Sólo se arma el componente "body" cuando hay variables reales
            // que mandar — un template sin variables (como hello_world) no
            // necesita `components` en absoluto.
            ...(bodyParameters.length > 0
                ? { components: [{ type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) }] }
                : {}),
        },
    });
}

// Mismo patrón LAZY que getWhatsappVerifyToken/getWhatsappAccessToken: el
// nombre/idioma del template de autenticación (OTP) NO se hardcodea —
// depende de qué plantilla se haya creado y aprobado en el panel de Meta
// (ver informe de entrega para el diseño exacto sugerido). Si falta
// configurar, el envío del código debe fallar de forma clara y controlada
// — NUNCA simular que el código se mandó.
let cachedOtpTemplateName;
export function getWhatsappOtpTemplateName() {
    if (cachedOtpTemplateName) return cachedOtpTemplateName;
    const value = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_OTP_TEMPLATE_NAME (plantilla de Meta para el código de verificación).");
    }
    cachedOtpTemplateName = value.trim();
    return cachedOtpTemplateName;
}

let cachedOtpTemplateLanguage;
export function getWhatsappOtpTemplateLanguage() {
    if (cachedOtpTemplateLanguage) return cachedOtpTemplateLanguage;
    const value = process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_OTP_TEMPLATE_LANGUAGE.");
    }
    cachedOtpTemplateLanguage = value.trim();
    return cachedOtpTemplateLanguage;
}

// Envía el código de 6 dígitos como template de autenticación — nunca como
// texto libre (sendWhatsappTextMessage), ver el comentario de
// sendWhatsappTemplateMessage. Si las variables de entorno no están
// configuradas todavía (plantilla no creada/aprobada en Meta), lanza un
// Error simple ANTES de intentar ningún request — mismo criterio que
// getWhatsappAccessToken: error de configuración, no una respuesta de Meta.
export async function sendWhatsappOtpTemplate({ to, code }) {
    const templateName = getWhatsappOtpTemplateName();
    const languageCode = getWhatsappOtpTemplateLanguage();
    return sendWhatsappTemplateMessage({ to, templateName, languageCode, bodyParameters: [code] });
}

// Mismo criterio LAZY, para el mensaje de bienvenida posterior a una
// migración exitosa. A diferencia del OTP, este mensaje es best-effort
// (nunca bloquea ni revierte una migración ya confirmada) — ver
// whatsappNumberChange.service.js. Devuelve `null` (no lanza) si falta
// configurar, para que el caller pueda tratarlo como "no se pudo enviar,
// pero no es un error fatal" sin un try/catch extra.
let cachedWelcomeTemplateName;
export function getWhatsappWelcomeTemplateName() {
    if (cachedWelcomeTemplateName) return cachedWelcomeTemplateName;
    const value = process.env.WHATSAPP_WELCOME_TEMPLATE_NAME;
    cachedWelcomeTemplateName = value && value.trim() ? value.trim() : null;
    return cachedWelcomeTemplateName;
}

let cachedWelcomeTemplateLanguage;
export function getWhatsappWelcomeTemplateLanguage() {
    if (cachedWelcomeTemplateLanguage) return cachedWelcomeTemplateLanguage;
    const value = process.env.WHATSAPP_WELCOME_TEMPLATE_LANGUAGE;
    cachedWelcomeTemplateLanguage = value && value.trim() ? value.trim() : null;
    return cachedWelcomeTemplateLanguage;
}

// {success:false, error:"WELCOME_TEMPLATE_NOT_CONFIGURED"} en vez de lanzar
// — el caller (whatsappNumberChange.service.js) ya trata cualquier
// {success:false} de este envío como "no bloquea la migración, sólo se
// loguea", así que no hace falta un camino de error separado para "no
// configurado" vs. "Meta lo rechazó".
export async function sendWhatsappWelcomeTemplate({ to, firstName, organizationName }) {
    const templateName = getWhatsappWelcomeTemplateName();
    const languageCode = getWhatsappWelcomeTemplateLanguage();
    if (!templateName || !languageCode) {
        return { success: false, messageId: null, error: "WELCOME_TEMPLATE_NOT_CONFIGURED" };
    }
    return sendWhatsappTemplateMessage({ to, templateName, languageCode, bodyParameters: [firstName, organizationName] });
}

// ==================================================================
// Verificación de teléfono/WhatsApp de Organización (Organization.phone) —
// flujo INVERTIDO: EL ORGANIZADOR inicia la conversación de WhatsApp hacia
// el número oficial de PaseCultural (deep link wa.me con "CONFIRMAR
// <token>" prearmado, ver organizationPhoneVerification.service.js) — nunca
// al revés, así que esta feature NO manda ningún template de Meta y no
// depende de que exista uno aprobado. Lo único que hace falta configurar es
// EL NÚMERO OFICIAL que hay que abrir en WhatsApp: mismo criterio LAZY que
// el resto de este archivo, pero deliberadamente DISTINTO de
// WHATSAPP_PHONE_NUMBER_ID (ese es el phone_number_id interno de Meta para
// la Graph API, nunca el número real en formato E.164 que necesita un
// enlace wa.me/<número>).
// ==================================================================

let cachedDisplayPhoneNumber;
export function getWhatsappDisplayPhoneNumber() {
    if (cachedDisplayPhoneNumber) return cachedDisplayPhoneNumber;
    const value = process.env.WHATSAPP_DISPLAY_PHONE_NUMBER;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno WHATSAPP_DISPLAY_PHONE_NUMBER (número oficial de WhatsApp de PaseCultural, formato wa.me — sólo dígitos, con código de país, sin '+').");
    }
    cachedDisplayPhoneNumber = value.trim();
    return cachedDisplayPhoneNumber;
}

// ==================================================================
// Respuesta automática mínima — Fase 2D. Sigue sin EventCreationEngine/
// EventServicePort/Prisma: sólo decide "¿a este mensaje le corresponde
// nuestra única respuesta fija?", nunca envía nada por sí misma (eso lo
// hace whatsapp.controller.js, con sendWhatsappTextMessage de más arriba).
// ==================================================================

export const AUTO_REPLY_TEXT = "¡Hola! 👋 Soy el asistente de PaseCultural. ¿Querés publicar un evento?";

// ==================================================================
// Normalización de destinatario de salida — Fase 2D.1. SOLO para el
// auto-reply: nunca toca sendWhatsappTextMessage/postToGraphApi de más
// arriba, que se usan igual en producción real. El número entrante
// siempre trae el "9" de móvil argentino (549XXXXXXXXXX), pero el
// destinatario autorizado en el entorno de prueba de Meta lo expone SIN
// ese "9" (54XXXXXXXXXX) — confirmado enviando desde el propio panel de
// Meta. Fuera de WHATSAPP_TEST_MODE=true esta función es un no-op:
// processInboundMessage sigue mandando exactamente a message.from, igual
// que antes de esta fase.
// ==================================================================

const ARGENTINA_MOBILE_WITH_NINE_REGEX = /^549(\d{10})$/;

// Pura — nunca lee process.env, así se puede testear sin mockear nada.
// testModeEnabled es un booleano explícito (no un string ni un objeto de
// config) para que el caller decida de dónde sale, sin acoplar esta
// función a ninguna variable de entorno en particular. Sólo convierte el
// patrón específico 549+10 dígitos (móvil argentino con el "9" del
// formato de la Cloud API); cualquier otro país o forma queda sin tocar.
export function normalizeWhatsappOutboundRecipient(phone, testModeEnabled) {
    if (!testModeEnabled || typeof phone !== "string") return phone;
    const match = phone.match(ARGENTINA_MOBILE_WITH_NINE_REGEX);
    return match ? `54${match[1]}` : phone;
}

// Único punto que lee la variable de entorno — LAZY como el resto del
// archivo, pero sin cachear: a diferencia del token/phone-number-id, este
// flag puede cambiar entre tests dentro del mismo proceso, y leer
// process.env.WHATSAPP_TEST_MODE es prácticamente gratis.
export function isWhatsappTestModeEnabled() {
    return process.env.WHATSAPP_TEST_MODE === "true";
}

// Pura, sin I/O — recibe un mensaje YA normalizado por
// parseInboundWhatsappMessages. Nunca responde a: status updates (no tienen
// `type`/`text`, quedan filtrados por type!=="text"), mensajes sin `from`,
// mensajes no-text (image/audio/.../ya vienen con text:null del parser),
// texto null, o texto vacío/sólo espacios.
export function shouldAutoReply(message) {
    return Boolean(
        message &&
            message.type === "text" &&
            typeof message.text === "string" &&
            message.text.trim().length > 0 &&
            typeof message.from === "string" &&
            message.from.length > 0
    );
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
