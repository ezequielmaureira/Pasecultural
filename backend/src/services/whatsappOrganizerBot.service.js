// Fase 2E — lógica de presentación específica de WhatsApp: NO reimplementa
// ninguna regla de EventCreationEngine, sólo (a) decide qué hacer ANTES de
// que exista una conversación (saludo/afirmativo/negativo) y (b) traduce la
// respuesta REAL del motor a un texto plano. El motor nunca se entera de
// que este texto va a Meta.

import { isValidCalendarDateString, normalizeCalendarDateString } from "../utils/calendarDate.js";
import { isValidTimeString } from "../conversation/inputHandlers/time.js";

export const WHATSAPP_DECLINE_TEXT = "Perfecto 👍 Cuando quieras publicar un evento, escribime.";

export const WHATSAPP_CANCEL_TEXT = "❌ Cancelamos la creación de tu evento. Cuando quieras, escribime para empezar de nuevo.";

// ==================================================================
// Bug fix (carga de imagen del evento) — textos del adaptador de imágenes.
// La lógica real (Meta Media API + Cloudinary) vive en
// whatsappMediaUpload.service.js; acá sólo se traduce cada resultado a un
// mensaje claro que le permita al organizador volver a intentar.
// ==================================================================

// El step actual del motor no es IMAGE_URL (ver EventCreationEngine.resume
// en whatsapp.controller.js) — la imagen no se procesa ni se le pasa al
// motor, se re-muestra la pregunta real vigente.
export const WHATSAPP_IMAGE_NOT_EXPECTED_TEXT = "En este paso no necesito una imagen.";

const IMAGE_UPLOAD_ERROR_TEXTS = {
    MISSING_MEDIA_ID: "No pudimos leer esa imagen. Probá enviarla de nuevo.",
    INVALID_MIME_TYPE: "Ese formato de imagen no es compatible. Mandame una imagen JPG, PNG o WEBP.",
    FILE_TOO_LARGE: "La imagen es muy pesada (máximo 5 MB). Probá con otra.",
    META_METADATA_ERROR: "No pudimos leer esa imagen desde WhatsApp. Probá enviarla de nuevo.",
    META_DOWNLOAD_ERROR: "No pudimos descargar esa imagen desde WhatsApp. Probá enviarla de nuevo.",
    CLOUDINARY_ERROR: "No pudimos guardar esa imagen. Probá enviarla de nuevo en un momento.",
};

// `reason` viene siempre de uploadWhatsappImageMessage (whatsappMediaUpload.service.js)
// — un motivo desconocido cae al mensaje genérico, nunca revienta ni expone
// el `reason` crudo al usuario.
export function buildWhatsappImageUploadErrorText(reason) {
    return IMAGE_UPLOAD_ERROR_TEXTS[reason] ?? "No pudimos procesar esa imagen. Probá enviarla de nuevo.";
}

// ==================================================================
// Bug fix (ubicación exclusivamente por WhatsApp Location) — textos y
// transformación del adaptador de ubicación. La única regla de negocio real
// (qué es válido para avanzar) vive en inputHandlers/location.js, que ahora
// también acepta coordenadas solas (sin dirección escrita) — acá sólo se
// decide CÓMO pedirlo/reintentarlo por WhatsApp y cómo traducir el
// `location` real que manda Meta al shape que ese input handler espera.
// ==================================================================

// Reemplaza el prompt genérico del step LOCATION (pensado para Web, con
// picker de Google Maps) cuando el canal es WhatsApp — ver
// extractWhatsappReplyText más abajo. No se toca steps/definitions.js: el
// texto Web original sigue intacto, esto es sólo cómo lo renderiza el
// adaptador de WhatsApp.
export const WHATSAPP_LOCATION_PROMPT_TEXT =
    "📍 ¿Dónde se realiza el evento?\n\nCompartime la ubicación del lugar desde WhatsApp.\n\nTocá 📎 → Ubicación y buscá/seleccioná el lugar donde se realiza el evento.";

// El usuario escribió texto (o mandó cualquier otra cosa que no sea una
// ubicación real) mientras el motor esperaba justo este step — nunca se
// interpreta ese texto como dirección ni se geocodifica, se vuelve a pedir
// la ubicación nativa.
export const WHATSAPP_LOCATION_RETRY_TEXT =
    "📍 Para continuar, compartime la ubicación del lugar desde WhatsApp.\n\nTocá 📎 → Ubicación y buscá/seleccioná el lugar del evento.";

// El step actual del motor no es LOCATION (ver EventCreationEngine.resume
// en whatsapp.controller.js, mismo criterio que WHATSAPP_IMAGE_NOT_EXPECTED_TEXT)
// — la ubicación compartida no se procesa ni se le pasa al motor, se
// re-muestra la pregunta real vigente.
export const WHATSAPP_LOCATION_NOT_EXPECTED_TEXT = "No necesito una ubicación en este paso.";

// Traduce el `location` que ya normalizó whatsapp.service.js
// ({latitude, longitude, name, address}) al shape que espera
// inputHandlers/location.js ({address, city, province, venueName,
// latitude, longitude, googlePlaceId}). WhatsApp NUNCA entrega
// ciudad/provincia por separado — se dejan sin definir a propósito (nunca
// se inventa un valor), el input handler ya sabe aceptar coordenadas sin
// ellas. `name`, cuando el usuario compartió un lugar buscado (no una
// ubicación en vivo), se usa como venueName; `address`, si Meta la dio, se
// usa tal cual.
export function buildLocationInputFromWhatsapp(location) {
    return {
        latitude: location.latitude,
        longitude: location.longitude,
        venueName: location.name ?? null,
        address: location.address ?? null,
    };
}

// El organizador termina el chatbot entero sólo para descubrir, recién al
// publicar, que la ubicación que compartió no alcanza — assertPublishable
// (event.service.js) exige EXACTAMENTE: venueName no vacío Y (formattedAddress
// O addressLine) no vacío. EventServicePort#buildLocationInput deriva
// venueName = location.venueName || location.address (si falta el nombre,
// cae a la dirección) y formattedAddress/addressLine = location.address
// directo — con esa fórmula, el ÚNICO campo verdaderamente indispensable
// para que la ubicación pueda publicarse después es `address`: si está,
// venueName también queda cubierto por el fallback aunque WhatsApp no haya
// mandado `name`. Un pin de "ubicación actual" (sin name NI address) nunca
// lo satisface. Se valida ACÁ, antes de guardar nada en el draft, para que
// el organizador se entere en el momento — no al final del flujo. Nunca
// exige city/province (assertPublishable no las pide) ni inventa ninguno de
// esos dos valores.
export function isPublishableWhatsappLocation(location) {
    return Boolean(location && typeof location.address === "string" && location.address.trim());
}

// El pin/ubicación actual no alcanza (ver isPublishableWhatsappLocation) —
// se le pide puntualmente buscar y seleccionar el establecimiento, no
// compartir dónde está parado.
export const WHATSAPP_LOCATION_INSUFFICIENT_TEXT =
    "📍 Necesito la ubicación del lugar del evento.\n\nTocá 📎 → Ubicación, buscá el nombre del lugar y seleccioná el establecimiento.\n\nNo envíes solamente tu ubicación actual.";

// ==================================================================
// Bug fix (UX y validación de fecha) — step FUNCTIONS_SINGLE_CARD
// (inputType FUNCTION_CARD, "una sola función"). El motor exige fecha +
// hora de inicio + hora de fin JUNTAS en una sola respuesta (así las arma
// FunctionCardAnswer.jsx, el formulario compuesto de la Web) — no existe
// ningún step que pida sólo una fecha. WhatsApp, al ser texto libre, pide
// las tres cosas en UN solo mensaje con un formato fijo y las traduce acá
// al mismo shape {date, startTime, endTime} que ya espera
// inputHandlers/functionCard.js — el motor no se entera de que este texto
// existe, sigue validando exactamente lo mismo que siempre (fecha de
// calendario real vía isValidCalendarDateString, horario HH:mm vía
// isValidTimeString — ninguna de las dos se reimplementa, se importan tal
// cual). No hay reglas de fecha mínima/máxima/pasada en el motor hoy: no se
// inventa ninguna acá tampoco.
// ==================================================================

export const WHATSAPP_FUNCTION_CARD_PROMPT_TEXT =
    "📅 ¿Cuándo es la función?\n\nEscribime la fecha y el horario así:\nDD/MM/AAAA HH:MM a HH:MM\n\nEjemplo:\n25/08/2026 20:00 a 23:00";

export const WHATSAPP_FUNCTION_CARD_RETRY_TEXT =
    "❌ No pude reconocer esa fecha y horario.\n\nEscribilo así:\nDD/MM/AAAA HH:MM a HH:MM\n\nEjemplo:\n25/08/2026 20:00 a 23:00";

// Formato ÚNICO y estricto a propósito (sección 5 del pedido: "no necesito
// múltiples formatos si eso agrega complejidad") — día y mes SIEMPRE de 2
// dígitos, año de 4. "25/8/2026", "25-08-2026" o "25.08.2026" no matchean:
// se rechazan con el mismo mensaje que pide el formato exacto, no se amplía
// la tolerancia. Espacios extra entre los tres campos se toleran (WhatsApp
// suele agregar espacios raros al copiar/pegar), la palabra "a" entre
// horarios no distingue mayúsculas.
const FUNCTION_CARD_TEXT_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})$/i;

// Devuelve {date, startTime, endTime} (mismo shape que
// inputHandlers/functionCard.js#parse) sólo si el texto matchea el formato
// EXACTO y además representa una fecha/horarios REALES — nunca sólo un
// chequeo de forma. "31/02/2026" matchea el regex pero
// isValidCalendarDateString la rechaza (Date.UTC roundtrip, ver
// utils/calendarDate.js) exactamente igual que ya lo hace Web para el mismo
// campo. Devuelve `null` (nunca inventa un valor parcial) ante cualquier
// desajuste — el caller decide qué hacer con eso (ver whatsapp.controller.js).
export function parseWhatsappFunctionCardText(rawText) {
    if (typeof rawText !== "string") return null;
    const normalized = rawText.trim().replace(/\s+/g, " ");
    const match = FUNCTION_CARD_TEXT_PATTERN.exec(normalized);
    if (!match) return null;

    const [, day, month, year, startTime, endTime] = match;
    const isoDate = `${year}-${month}-${day}`;
    if (!isValidCalendarDateString(isoDate)) return null;
    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) return null;

    return { date: normalizeCalendarDateString(isoDate), startTime, endTime };
}

// Fase 2F — LEGACY, sin uso desde Fase 2G (ver informe de entrega: el
// flujo de código de 6 dígitos deja de ofrecerse desde WhatsApp Organizer).
// Se conservan intactas junto con whatsappOrganizerLink.service.js/
// WhatsappLinkChallenge por pedido explícito de no hacer una limpieza
// destructiva — simplemente ya nadie las importa desde
// whatsapp.controller.js.
export function buildWhatsappLinkChallengeText(code) {
    return `Para vincular este WhatsApp con tu cuenta de PaseCultural, ingresá este código en tu panel de organizador:\n\n${code}\n\nEl código vence en 10 minutos.`;
}

export const WHATSAPP_LINK_CHALLENGE_PENDING_TEXT =
    "Ya te enviamos un código para vincular este WhatsApp. Revisá los mensajes anteriores; si no te llegó, esperá un minuto y volvé a escribir.";

// ==================================================================
// Fase 2G — identificación automática por teléfono + múltiples
// Organizations. Mismo criterio que el resto del archivo: sólo texto,
// nunca reglas de negocio (esas viven en whatsappOrganizerDiscovery.service.js).
// ==================================================================

// Caso A (auditoría Fase 2G): exactamente una Organization APPROVED con el
// teléfono de este wa_id — saludo personalizado en vez del genérico
// AUTO_REPLY_TEXT.
export function buildKnownOrganizationGreetingText(organizationName) {
    return `Hola ${organizationName} 👋 Soy el asistente de PaseCultural. ¿Querés publicar un evento?`;
}

// Caso C: el teléfono no coincide con ninguna Organization APPROVED. Nunca
// dispara un challenge/código — sólo indica cómo corregirlo desde la web.
export const WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT =
    "No encontré una organización habilitada asociada a este número de WhatsApp.\n\nIngresá a PaseCultural y verificá que el teléfono registrado en tu organización sea el mismo número desde el que estás escribiendo.";

// Caso B: varias Organizations APPROVED comparten el mismo teléfono —
// selector numerado, en el MISMO orden que candidateOrganizationIds (nunca
// se reordena entre el mensaje y la validación de la respuesta).
export function buildOrganizationSelectorText(candidates) {
    const options = candidates.map((candidate, index) => `${index + 1}. ${candidate.name}`).join("\n");
    return `Encontré varias organizaciones asociadas a este número.\n\n¿Con cuál querés trabajar?\n\n${options}`;
}

// La respuesta no fue un número válido de la lista mostrada — nunca se
// acepta un organizationId/nombre/clerkId escrito a mano (ver sección
// "selección" del informe de entrega).
export const WHATSAPP_SELECTION_INVALID_TEXT = "No entendí esa opción. Respondé con el número de la organización de la lista.";

export function buildOrganizationSelectedConfirmationText(organizationName) {
    return `Perfecto. Estás trabajando con ${organizationName}.\n¿Querés publicar un evento?`;
}

// Mientras se espera la confirmación final ("Sí"/"No") tras elegir una
// Organization entre varias, cualquier respuesta que no sea afirmativa ni
// negativa vuelve a preguntar sin repetir el selector numerado (la
// Organization ya está resuelta, sólo falta confirmar la intención).
export function buildOrganizationSelectionConfirmationRetryText(organizationName) {
    return `¿Querés publicar un evento con ${organizationName}? Respondé "Sí" o "No".`;
}

// ==================================================================
// classifyInitialIntent — SOLO para el mensaje previo a iniciar el motor
// (sección 3B/3C/3D del pedido). Determinística, sin IA: normaliza
// mayúsculas/tildes/espacios/signos simples y compara contra un set fijo
// de frases — no es un NLP, no interpreta nada fuera de esa lista.
// ==================================================================

function normalizeIntentText(text) {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // tildes
        .toLowerCase()
        .replace(/[¡!¿?.,]/g, "") // signos simples
        .replace(/\s+/g, " ")
        .trim();
}

const AFFIRMATIVE_PHRASES = new Set(["si", "s", "dale", "ok", "quiero", "quiero publicar", "publicar", "crear", "crear evento"]);

const NEGATIVE_PHRASES = new Set(["no", "no gracias", "ahora no", "despues"]);

export function classifyInitialIntent(text) {
    if (typeof text !== "string") return "UNKNOWN";
    const normalized = normalizeIntentText(text);
    if (!normalized) return "UNKNOWN";
    if (AFFIRMATIVE_PHRASES.has(normalized)) return "AFFIRMATIVE";
    if (NEGATIVE_PHRASES.has(normalized)) return "NEGATIVE";
    return "UNKNOWN";
}

// ==================================================================
// isCancelCommand — sección 8: sólo estas 3 palabras, sólo con
// conversación activa (lo decide el controller, no esta función).
// ==================================================================

const CANCEL_COMMANDS = new Set(["cancelar", "cancel", "salir"]);

export function isCancelCommand(text) {
    if (typeof text !== "string") return false;
    return CANCEL_COMMANDS.has(normalizeIntentText(text));
}

// ==================================================================
// Bug fix (post Fase 2G) — un step SINGLE_SELECT (CATEGORY, FUNCTIONS_MODE,
// EVENT_PRICING_TYPE, TICKET_NAME, ADD_ANOTHER_TICKET, SOCIAL_NETWORK, ver
// steps/definitions.js) manda su prompt como {text, options}. El motor SÍ
// entrega `options` (EventCreationEngine.buildPrompt hace spread de todo lo
// que devuelve step.buildPrompt) — el bug estaba acá: extractWhatsappReplyText
// sólo devolvía `prompt.text` y descartaba `prompt.options` por completo, así
// que en WhatsApp el organizador se quedaba sin ver ninguna opción para
// responder. formatOptionsList es el ÚNICO renderer, genérico para
// cualquier SINGLE_SELECT (no hardcodea categorías ni ningún otro step) — las
// opciones vienen SIEMPRE de prompt.options, la misma fuente que ya usa Web.
// ==================================================================

function formatOptionsList(options) {
    return options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
}

// El motor (singleSelect.js#parse) espera SIEMPRE el `id` real de una
// opción, nunca un índice — ese contrato es compartido con Web y no se toca.
// Este helper es exclusivo del adaptador de WhatsApp: convierte una
// respuesta numérica ("1".."N") al `id` real de esa posición en la MISMA
// lista `options` que se le mostró al usuario — nunca recalculada, nunca
// otra fuente. Sólo un índice 1-based dentro de rango es válido; cualquier
// otra cosa (0, negativo, fuera de rango, texto libre) devuelve `null` y
// dejar que el motor rechace la respuesta con su propio mensaje de error
// (que, gracias al fix de arriba, vuelve a mostrar las opciones).
export function resolveSingleSelectIndexReply(options, rawText) {
    if (!Array.isArray(options) || options.length === 0) return null;
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!/^\d+$/.test(trimmed)) return null;

    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1 || index > options.length) return null;

    return options[index - 1].id;
}

// ==================================================================
// extractWhatsappReplyText — toma la respuesta REAL de
// EventCreationEngine.start/handleInput (ver toConversationResult/
// handlePreviewInput en EventCreationEngine.js) y devuelve el texto plano
// a mandar por WhatsApp. Nunca manda el objeto crudo ni metadata interna
// (sections, canGoBack, currentValue, draft completo, etc.) — salvo
// `options`, que si está presente SÍ se traduce a texto (ver arriba): es
// justamente lo que el organizador necesita para poder responder.
// ==================================================================

export function extractWhatsappReplyText(engineResult) {
    if (!engineResult) return null;

    // handlePreviewInput terminó el flujo con PUBLISH/DRAFT: {conversationId, done:true, status, event}.
    if (engineResult.done) {
        return engineResult.status === "PUBLISHED"
            ? "🎉 ¡Listo! Tu evento ya está publicado."
            : "📝 Guardamos tu evento como borrador.";
    }

    const prompt = engineResult.prompt;
    if (!prompt) return null;

    // El paso PREVIEW no tiene `text` (trae `draft` completo, ver
    // buildPrompt) — publicar/guardar borrador por comando de texto libre
    // queda fuera del alcance de esta fase (sección 8: sólo se mapea
    // cancelar). Se informa sin filtrar el draft ni pedir un comando que
    // todavía no existe.
    if (prompt.type === "PREVIEW") {
        return prompt.error
            ? `⚠️ ${prompt.error}`
            : "Llegaste al resumen final de tu evento. Por ahora, terminá de revisarlo y publicarlo desde la web de PaseCultural.";
    }

    // type === "QUESTION", step LOCATION — reemplaza el prompt genérico
    // (pensado para el picker de Google Maps de la Web) por las
    // instrucciones de ubicación nativa de WhatsApp; nunca se muestra
    // `prompt.text` ni `prompt.error` del motor para este step (el error
    // real siempre es "faltó dirección/ciudad/provincia", que no aplica al
    // canal WhatsApp y confundiría más de lo que ayuda).
    if (prompt.inputType === "LOCATION") {
        return prompt.error ? WHATSAPP_LOCATION_RETRY_TEXT : WHATSAPP_LOCATION_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_SINGLE_CARD — mismo criterio que
    // LOCATION: reemplaza el prompt genérico ("Contame cuándo es la
    // función.", pensado para el formulario compuesto de la Web) por el
    // formato de texto único que espera parseWhatsappFunctionCardText.
    if (prompt.inputType === "FUNCTION_CARD") {
        return prompt.error ? WHATSAPP_FUNCTION_CARD_RETRY_TEXT : WHATSAPP_FUNCTION_CARD_PROMPT_TEXT;
    }

    // type === "QUESTION" — si el motor marcó un error de validación sobre
    // la respuesta anterior, va primero, seguido de la pregunta reenviada
    // (mismo prompt, ver buildPrompt): respeta el orden "primero el error,
    // después qué hacer". Si el step trae `options` (SINGLE_SELECT), se
    // listan numeradas EN EL MISMO ORDEN que las entrega el motor, con una
    // instrucción explícita de cómo responder.
    const baseText = prompt.error ? `⚠️ ${prompt.error}\n\n${prompt.text}` : prompt.text;
    if (Array.isArray(prompt.options) && prompt.options.length > 0) {
        return `${baseText}\n\n${formatOptionsList(prompt.options)}\n\nRespondé con el número de la opción.`;
    }
    return baseText;
}
