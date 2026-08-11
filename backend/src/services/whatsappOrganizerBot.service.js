// Fase 2E — lógica de presentación específica de WhatsApp: NO reimplementa
// ninguna regla de EventCreationEngine, sólo (a) decide qué hacer ANTES de
// que exista una conversación (saludo/afirmativo/negativo) y (b) traduce la
// respuesta REAL del motor a un texto plano. El motor nunca se entera de
// que este texto va a Meta.

import { isValidCalendarDateString, normalizeCalendarDateString, compareCalendarDateStrings } from "../utils/calendarDate.js";
import { isValidTimeString } from "../conversation/inputHandlers/time.js";
import { ARGENTINA_PROVINCES } from "../utils/argentinaProvinces.js";

export const WHATSAPP_DECLINE_TEXT = "Perfecto 👍 Cuando quieras publicar un evento, escribime.";

export const WHATSAPP_CANCEL_TEXT = "❌ Cancelamos la creación de tu evento. Cuando quieras, escribime para empezar de nuevo.";

// Fase 3G, sección 5 — "volver" ya existía (Fase 3D) pero nunca se le
// avisaba al organizador que existía. Se agrega, de forma consistente, a
// las preguntas principales de cada sub-flujo conversacional adaptado a
// WhatsApp — nunca a los steps SINGLE_SELECT genéricos (CATEGORY,
// FUNCTIONS_MODE, EVENT_PRICING_TYPE, TICKET_NAME, ADD_ANOTHER_TICKET,
// SOCIAL_NETWORK) porque esos NO tienen ningún manejo de "volver" propio
// todavía (ver informe de entrega) — anunciar ahí un comando que no
// funciona sería peor que no decir nada.
export const WHATSAPP_BACK_HINT_TEXT = "\n\n↩️ Escribí VOLVER para regresar al paso anterior.";

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
// Fase 3D — ubicación conversacional: al llegar al step LOCATION, WhatsApp
// pregunta PRIMERO cómo cargarla (compartir vs dirección manual paso a
// paso) — reemplaza el prompt directo de "compartime tu ubicación" de la
// fase anterior (WHATSAPP_LOCATION_PROMPT_TEXT/WHATSAPP_LOCATION_RETRY_TEXT,
// eliminados). La orquestación completa (WhatsappPendingStepInput,
// sub-estados AWAITING_LOCATION_METHOD/AWAITING_LOCATION_SHARE/
// AWAITING_STREET/AWAITING_STREET_NUMBER/AWAITING_CITY/AWAITING_PROVINCE)
// vive en whatsapp.controller.js#tryHandleLocationSubflow — acá sólo
// textos y transformaciones puras, igual que el resto del archivo. La
// única regla de negocio real (qué es válido para avanzar el motor) sigue
// viviendo en inputHandlers/location.js, sin cambios.
// ==================================================================

export const WHATSAPP_LOCATION_METHOD_PROMPT_TEXT =
    `📍 ¿Cómo querés cargar la ubicación del evento?\n\n1. Compartir ubicación\n2. Completar dirección manualmente\n\nRespondé con 1 o 2.${WHATSAPP_BACK_HINT_TEXT}`;

export const WHATSAPP_LOCATION_METHOD_INVALID_TEXT =
    "❌ Esa opción no existe.\n\n1. Compartir ubicación\n2. Completar dirección manualmente\n\nRespondé con 1 o 2.";

// Opción 1 — compartir. Preferí buscar el lugar por nombre (no un pin en
// vivo): isPublishableWhatsappLocation, más abajo, es quien realmente
// exige que haya `address` — este texto sólo orienta la búsqueda.
export const WHATSAPP_LOCATION_SHARE_PROMPT_TEXT =
    `📍 Compartime la ubicación del lugar desde WhatsApp.\n\nTocá 📎 → Ubicación y buscá/seleccioná el establecimiento donde se realiza el evento.\n\nPreferentemente seleccioná el lugar buscándolo por nombre.${WHATSAPP_BACK_HINT_TEXT}`;

// El usuario escribió texto (o mandó cualquier otra cosa que no sea una
// ubicación real) mientras se esperaba justo una ubicación compartida —
// nunca se interpreta ese texto como dirección ni se geocodifica.
export const WHATSAPP_LOCATION_SHARE_RETRY_TEXT =
    "📍 Para continuar, compartime la ubicación del lugar desde WhatsApp.\n\nTocá 📎 → Ubicación y buscá/seleccioná el establecimiento.";

// Opción 2 — dirección manual, paso a paso (una pregunta = un dato).
export const WHATSAPP_LOCATION_STREET_PROMPT_TEXT = `🛣️ ¿Cuál es la calle?\n\nEjemplo:\nSan Martín${WHATSAPP_BACK_HINT_TEXT}`;
export const WHATSAPP_LOCATION_STREET_INVALID_TEXT = "❌ Necesito el nombre de la calle.\n\nEjemplo:\nSan Martín";

export const WHATSAPP_LOCATION_STREET_NUMBER_PROMPT_TEXT = `🔢 ¿Cuál es la altura?\n\nEjemplo:\n850${WHATSAPP_BACK_HINT_TEXT}`;
export const WHATSAPP_LOCATION_STREET_NUMBER_INVALID_TEXT =
    "❌ No pude reconocer esa altura.\n\nEscribila en números.\n\nEjemplo:\n850";

export const WHATSAPP_LOCATION_CITY_PROMPT_TEXT = `🏙️ ¿En qué ciudad se realiza?\n\nEjemplo:\nRío Cuarto${WHATSAPP_BACK_HINT_TEXT}`;
export const WHATSAPP_LOCATION_CITY_INVALID_TEXT = "❌ Necesito el nombre de la ciudad.\n\nEjemplo:\nRío Cuarto";

function buildProvinceOptionsList() {
    return ARGENTINA_PROVINCES.map((name, index) => `${index + 1}. ${name}`).join("\n");
}

export function buildLocationProvincePromptText() {
    return `🗺️ ¿En qué provincia?\n\n${buildProvinceOptionsList()}\n\nRespondé con el número.${WHATSAPP_BACK_HINT_TEXT}`;
}

export function buildLocationProvinceInvalidText() {
    return `❌ Esa opción no existe.\n\n${buildProvinceOptionsList()}\n\nRespondé con el número.`;
}

// Índice 1-based EXACTO contra ARGENTINA_PROVINCES — nunca coincidencia
// parcial/fuzzy (sección 12 del pedido: "No usar coincidencia parcial
// peligrosa... no hace falta fuzzy matching"). Devuelve el nombre real de
// la provincia (el shape que espera inputHandlers/location.js#parse en
// `province`), nunca el índice.
export function resolveArgentinaProvinceIndexReply(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!/^\d+$/.test(trimmed)) return null;

    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1 || index > ARGENTINA_PROVINCES.length) return null;

    return ARGENTINA_PROVINCES[index - 1];
}

// La altura se guarda como STRING (no Number) para concatenarla tal cual en
// `address` ("San Martín 850") sin riesgo de formateo (ej. ceros a la
// izquierda) — sólo se exige que sea un entero positivo real.
export function parseWhatsappStreetNumberText(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!/^\d+$/.test(trimmed)) return null;

    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return null;

    return trimmed;
}

// El motor rechazó el objeto LOCATION ya completo (no debería pasar nunca
// en la práctica: cada sub-campo ya se validó antes de llegar acá) — mismo
// criterio mínimo seguro que WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT: se
// documenta acá, la decisión de qué hacer con el pending vive en el
// controller.
export const WHATSAPP_LOCATION_COMMIT_ERROR_TEXT =
    "❌ No pudimos guardar esa ubicación.\n\nProbá completar la dirección de nuevo.";

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
// Fase 3G, sección 4 — confirmación de ubicación + link de Google Maps.
// Aplica IGUAL para las dos modalidades (compartida y manual): antes de
// mandarle el objeto LOCATION al motor, se arma un resumen legible + un
// link de Maps y se pide confirmación explícita (AWAITING_LOCATION_CONFIRMATION,
// whatsapp.controller.js#tryHandleLocationSubflow). Nunca se geocodifica ni
// se llama a ninguna API de Google — el link es una URL de búsqueda
// ESTÁNDAR (google.com/maps/search), navegable sin API key, construida sólo
// con los datos que YA tenemos (coordenadas si vinieron de "compartir
// ubicación", o dirección/ciudad/provincia si vino del camino manual).
// ==================================================================

// Sólo las líneas de texto legible (sin el link) — reutilizado tal cual por
// el resumen final del evento (sección 6, buildWhatsappEventSummaryText),
// para no mantener dos formatos de "cómo se ve una ubicación" en paralelo.
export function buildWhatsappLocationSummaryLines(location) {
    if (!location) return [];
    const lines = [];
    if (location.venueName) lines.push(location.venueName);
    const cityProvince = [location.city, location.province].filter(Boolean).join(", ");
    if (location.address) {
        lines.push(cityProvince ? `${location.address}, ${cityProvince}` : location.address);
    } else if (cityProvince) {
        lines.push(cityProvince);
    }
    return lines;
}

// Coordenadas -> link estándar por lat/lng. Sin coordenadas pero con
// dirección -> link de búsqueda por texto (URL-encoded). Ninguna de las dos
// formas llama a una API ni requiere credenciales — es el mismo esquema de
// URL que usa cualquier botón "Ver en Google Maps" de la web pública.
export function buildWhatsappGoogleMapsLink(location) {
    if (!location) return null;
    if (typeof location.latitude === "number" && typeof location.longitude === "number") {
        return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
    }
    const parts = [location.address, location.city, location.province].filter(Boolean);
    if (parts.length === 0) return null;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

// `location` es el objeto YA construido (buildLocationInputFromWhatsapp
// para "compartir", o el objeto manual ya armado con calle+altura+ciudad+
// provincia) — nunca se inventa ningún campo que no esté ahí.
export function buildWhatsappLocationConfirmationText(location) {
    const summaryLines = buildWhatsappLocationSummaryLines(location);
    const mapsLink = buildWhatsappGoogleMapsLink(location);
    const summaryBlock = summaryLines.length ? summaryLines.join("\n") : "Ubicación cargada";
    const mapsBlock = mapsLink ? `\n\n🗺️ Ver en Google Maps:\n${mapsLink}` : "";
    return `📍 Esta es la ubicación que tengo:\n\n${summaryBlock}${mapsBlock}\n\n¿Es correcta?\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.\n\n↩️ Escribí VOLVER para corregir.`;
}

// ==================================================================
// Fase 3C — step FUNCTIONS_SINGLE_CARD (inputType FUNCTION_CARD, "una sola
// función") conversacional en 3 mensajes: fecha, hora de inicio, hora de
// fin. Reemplaza el formato compuesto de un solo mensaje
// ("DD/MM/AAAA HH:MM a HH:MM", Fase anterior) — esa UX queda ELIMINADA, no
// se mantienen las dos en paralelo (ver informe de entrega). El motor
// (inputHandlers/functionCard.js) sigue exigiendo exactamente lo mismo de
// siempre, {date, startTime, endTime} en una sola llamada — la división en
// 3 preguntas es EXCLUSIVA del adaptador WhatsApp, orquestada con
// WhatsappPendingStepInput (whatsapp.controller.js#tryHandleFunctionCardSubflow).
// Los validadores reales del motor se reutilizan tal cual, nunca se
// reimplementan: isValidCalendarDateString/normalizeCalendarDateString
// (utils/calendarDate.js) para la fecha, isValidTimeString
// (inputHandlers/time.js) para los horarios.
// ==================================================================

export const WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT =
    `📅 ¿Qué día es la función?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026${WHATSAPP_BACK_HINT_TEXT}`;

export const WHATSAPP_FUNCTION_CARD_DATE_INVALID_TEXT =
    "❌ No pude reconocer esa fecha.\n\nEscribila así:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026";

// Fase 3C, sección 5/6 — fecha mínima = hoy, SÓLO para WhatsApp (no se
// mueve al motor compartido en esta fase, ver getArgentinaTodayDateString
// más abajo).
export const WHATSAPP_FUNCTION_CARD_DATE_PAST_TEXT =
    "❌ Esa fecha ya pasó.\n\nIngresá una fecha desde hoy en adelante.\n\nFormato:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026";

export const WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT =
    `🕐 ¿A qué hora comienza?\n\nEscribila así:\nHH:MM\n\nEjemplo:\n20:00${WHATSAPP_BACK_HINT_TEXT}`;

export const WHATSAPP_FUNCTION_CARD_END_TIME_PROMPT_TEXT =
    `🕐 ¿A qué hora termina?\n\nEscribila así:\nHH:MM\n\nEjemplo:\n23:00${WHATSAPP_BACK_HINT_TEXT}`;

// Mismo texto para hora de inicio Y hora de fin inválidas — el pedido dio
// un único texto de error para "horario" (sección 8), sin variantes.
export const WHATSAPP_FUNCTION_CARD_TIME_INVALID_TEXT =
    "❌ No pude reconocer ese horario.\n\nEscribilo así:\nHH:MM\n\nEjemplo:\n20:00";

// El motor rechazó el objeto {date,startTime,endTime} ya completo (no
// debería pasar nunca en la práctica: fecha y horarios ya se validaron uno
// por uno con los mismos validadores reales antes de llegar acá — ver
// informe de entrega, sección "comportamiento si el motor rechaza"). Nunca
// se pierden fecha/hora de inicio ya confirmadas: sólo se vuelve a pedir la
// hora de fin.
export const WHATSAPP_FUNCTION_CARD_COMMIT_ERROR_TEXT =
    "❌ No pudimos guardar la función con esos datos.\n\nVolvé a escribir la hora de finalización.\n\nFormato:\nHH:MM\n\nEjemplo:\n23:00";

// Formato ÚNICO y estricto a propósito (mismo criterio ya aprobado en la
// fase anterior: "no necesito múltiples formatos si eso agrega
// complejidad") — día y mes SIEMPRE de 2 dígitos, año de 4. "25/8/2026",
// "25-08-2026" o "25.08.2026" no matchean.
const FUNCTION_CARD_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

// Devuelve la fecha normalizada ("YYYY-MM-DD", el shape real que espera
// functionCard.js#parse) sólo si el texto matchea el formato EXACTO y
// además representa una fecha REAL — nunca sólo un chequeo de forma.
// "31/02/2026"/"32/08/2026"/"00/08/2026" matchean el regex pero
// isValidCalendarDateString los rechaza (Date.UTC roundtrip, ver
// utils/calendarDate.js), exactamente igual que ya lo hace Web para el
// mismo campo. Devuelve `null` (nunca inventa un valor parcial) ante
// cualquier desajuste.
export function parseWhatsappFunctionCardDateText(rawText) {
    if (typeof rawText !== "string") return null;
    const trimmed = rawText.trim();
    const match = FUNCTION_CARD_DATE_PATTERN.exec(trimmed);
    if (!match) return null;

    const [, day, month, year] = match;
    const isoDate = `${year}-${month}-${day}`;
    if (!isValidCalendarDateString(isoDate)) return null;

    return normalizeCalendarDateString(isoDate);
}

// Fase 3C, sección 5 — "hoy" para Argentina, SIN depender de la timezone
// del proceso de Node (que en Render corre en UTC). Mismo offset fijo
// (-03:00, sin horario de verano) que ya usa PLATFORM_UTC_OFFSET en
// utils/calendarDate.js — se duplica ACÁ deliberadamente (esa constante es
// privada de ese módulo, y el pedido pide explícitamente NO promover esta
// regla al motor compartido todavía, sólo implementarla dentro del
// adaptador WhatsApp). `now` es inyectable para poder testear el límite
// "hoy" exacto sin mockear el reloj global.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

export function getArgentinaTodayDateString(now = new Date()) {
    const shifted = new Date(now.getTime() - ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Compara FECHAS DE CALENDARIO (strings "YYYY-MM-DD", nunca instantes) con
// compareCalendarDateStrings — el mismo comparador que ya usa el motor para
// FUNCTIONS_RANGE (dateRange.js), reutilizado tal cual, nunca reimplementado.
export function isArgentineDateInThePast(normalizedDate, now = new Date()) {
    return compareCalendarDateStrings(normalizedDate, getArgentinaTodayDateString(now)) < 0;
}

// ==================================================================
// Fase 3E — step FUNCTIONS_LIST (inputType FUNCTIONS_LIST, "varias
// funciones", modo MULTIPLE de FUNCTIONS_MODE) conversacional: fecha ->
// hora de inicio -> hora de fin -> ¿agregar otra? -> repetir o finalizar.
// El motor (inputHandlers/functionsList.js) exige el ARRAY completo
// {date,startTime,endTime}[] en una sola llamada — el ciclo de captura de
// cada función y la decisión de agregar otra son EXCLUSIVOS del adaptador
// WhatsApp, orquestados con WhatsappPendingStepInput
// (whatsapp.controller.js#tryHandleFunctionsListSubflow). Reutiliza tal
// cual los mismos validadores/textos ya aprobados en Fase 3C para
// FUNCTIONS_SINGLE_CARD (misma fecha DD/MM/AAAA, mismo HH:MM, misma regla
// "fecha >= hoy Argentina") — nunca se reimplementan.
// ==================================================================

export const WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT =
    `📅 ¿Qué día es la primera función?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n25/08/2026${WHATSAPP_BACK_HINT_TEXT}`;

// Se muestra al arrancar cada función siguiente (después de responder "1"
// en AWAITING_MULTIPLE_ADD_ANOTHER) — misma validación, sólo cambia el
// enunciado para dejar claro que la anterior ya quedó guardada.
export const WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT =
    `📅 ¿Qué día es la siguiente función?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n26/08/2026${WHATSAPP_BACK_HINT_TEXT}`;

export function buildWhatsappFunctionsListDatePromptText(isFirstFunction) {
    return isFirstFunction ? WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT : WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_NEXT_TEXT;
}

export const WHATSAPP_FUNCTIONS_LIST_ADD_ANOTHER_INVALID_TEXT =
    "❌ Elegí una opción válida.\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.";

// El motor rechazó el array completo ya armado (no debería pasar nunca en
// la práctica: cada función ya se validó campo por campo con los mismos
// validadores reales antes de llegar acá) — nunca se pierden las funciones
// ya cargadas: el pending queda intacto en AWAITING_MULTIPLE_ADD_ANOTHER
// para que el organizador pueda reintentar finalizar o seguir agregando.
export const WHATSAPP_FUNCTIONS_LIST_COMMIT_ERROR_TEXT =
    "❌ No pudimos guardar las funciones cargadas.\n\n¿Querés agregar otra función?\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.";

// `date` ya viene normalizada ("YYYY-MM-DD", garantizado por
// parseWhatsappFunctionCardDateText) — presentación pura, exclusiva de este
// adaptador, nunca movida a calendarDate.js (ese módulo no tiene ningún
// formateador de exhibición, sólo parseo/aritmética). Exportada porque
// también la reutiliza el resumen final del evento (Fase 3G, sección 6).
export function formatCalendarDateForDisplay(normalizedDate) {
    const [year, month, day] = normalizedDate.split("-");
    return `${day}/${month}/${year}`;
}

export function buildWhatsappFunctionAddedSummaryText(fn) {
    return `✅ Función agregada\n\n${formatCalendarDateForDisplay(fn.date)}\n${fn.startTime} a ${fn.endTime}\n\n¿Querés agregar otra función?\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.${WHATSAPP_BACK_HINT_TEXT}`;
}

// ==================================================================
// Fase 3F — steps reales de FUNCTIONS_MODE = RECURRING (rango de fechas →
// días de semana → horarios), tres pasos reales distintos del motor
// (FUNCTIONS_RANGE/inputType DATE_RANGE, FUNCTIONS_WEEKDAYS/inputType
// WEEKDAYS, FUNCTIONS_RECURRING_SCHEDULES/inputType TIME_RANGE_LIST — ver
// steps/definitions.js), cada uno conversacional en el adaptador WhatsApp
// (whatsapp.controller.js#tryHandleRecurring*Subflow). Reutiliza tal cual
// los mismos validadores de fecha/hora ya aprobados en Fase 3C/3E — nunca
// se reimplementan. generateRecurringSlots sigue siendo EXCLUSIVO del motor
// (corre dentro de FUNCTIONS_RECURRING_SCHEDULES.setValue,
// steps/definitions.js) — WhatsApp nunca calcula fechas concretas, sólo
// recolecta rango/días/horarios y reenvía lo que el motor ya generó (ver
// comentario en tryHandleRecurringSchedulesSubflow).
// ==================================================================

export const WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT =
    `🔁 Vamos a configurar las funciones recurrentes.\n\n📅 ¿Desde qué fecha se repite el evento?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n20/08/2026${WHATSAPP_BACK_HINT_TEXT}`;

export const WHATSAPP_RECURRING_TO_DATE_PROMPT_TEXT =
    `📅 ¿Hasta qué fecha se repite?\n\nEscribí la fecha así:\nDD/MM/AAAA\n\nEjemplo:\n30/09/2026${WHATSAPP_BACK_HINT_TEXT}`;

// La misma regla "hasta >= desde" que ya exige inputHandlers/dateRange.js —
// se valida ACÁ, ANTES de llamar al motor (nunca se llama con un rango
// inválido), para poder mostrar el mensaje puntual del pedido y mantener
// `from` sin pedirlo de nuevo. No es una regla nueva: es la misma regla del
// handler real, aplicada del lado del adaptador para evitar un viaje al
// motor que ya sabemos que va a fallar.
export function isRecurringToBeforeFrom(from, to) {
    return compareCalendarDateStrings(to, from) < 0;
}

export const WHATSAPP_RECURRING_TO_BEFORE_FROM_TEXT =
    "❌ La fecha final no puede ser anterior a la fecha inicial.\n\nIngresá nuevamente la fecha hasta.\n\nFormato:\nDD/MM/AAAA\n\nEjemplo:\n30/09/2026";

export const WHATSAPP_RECURRING_RANGE_COMMIT_ERROR_TEXT =
    "❌ No pudimos guardar ese rango de fechas.\n\nVolvé a escribir la fecha hasta.\n\nFormato:\nDD/MM/AAAA\n\nEjemplo:\n30/09/2026";

// Días de semana — misma convención interna 0=Lunes..6=Domingo que ya usa
// el motor (ver comentario de generateRecurringSlots en
// steps/definitions.js e inputHandlers/weekdays.js). La UX de WhatsApp
// muestra 1=Lunes..7=Domingo (más natural para escribir) — el mapeo
// (uxDay - 1) es EXCLUSIVO de este adaptador, nunca se toca el motor.
const WHATSAPP_WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function buildWeekdayOptionsList() {
    return WHATSAPP_WEEKDAY_LABELS.map((name, index) => `${index + 1}. ${name}`).join("\n");
}

export const WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT = `📆 ¿Qué días se repite el evento?\n\n${buildWeekdayOptionsList()}\n\nPodés elegir uno o varios separados por coma.\n\nEjemplo:\n1,3,5${WHATSAPP_BACK_HINT_TEXT}`;

export const WHATSAPP_RECURRING_WEEKDAYS_INVALID_TEXT = `❌ No pude reconocer esos días.\n\n${buildWeekdayOptionsList()}\n\nPodés elegir uno o varios separados por coma.\n\nEjemplo:\n1,3,5`;

export const WHATSAPP_RECURRING_WEEKDAYS_COMMIT_ERROR_TEXT = `❌ No pudimos guardar esos días.\n\n${buildWeekdayOptionsList()}\n\nPodés elegir uno o varios separados por coma.\n\nEjemplo:\n1,3,5`;

// Acepta "1", "1,3,5", "1, 3, 5" — un índice 1-7 por token, separados por
// coma, sin importar espacios alrededor. Rechaza cualquier token fuera de
// 1-7, vacío (ej. "1,,3"), decimal/con puntos (ej. "1.3.5", que al no tener
// comas queda como un único token que no matchea el patrón de un solo
// dígito) o texto libre. Duplicados: se eliminan conservando el orden de la
// PRIMERA aparición (ej. "1,1,3" -> [0,2]) — no es una regla nueva de
// negocio, sólo la forma más simple y determinística de resolver una
// entrada repetida sin inventar semántica adicional; el motor
// (weekdays.js#parse) igualmente dedupea y ordena por su cuenta antes de
// guardar, así que el orden acá sólo afecta qué se le pasa, nunca lo que
// termina persistido. Devuelve `null` (nunca un array parcial) ante
// cualquier entrada inválida.
const WEEKDAY_UX_TOKEN_PATTERN = /^[1-7]$/;

export function parseWhatsappWeekdaySelection(rawText) {
    if (typeof rawText !== "string") return null;
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const tokens = trimmed.split(",").map((token) => token.trim());
    if (tokens.some((token) => !WEEKDAY_UX_TOKEN_PATTERN.test(token))) return null;

    const internalDays = [];
    for (const token of tokens) {
        const internalDay = Number(token) - 1; // 1..7 (Lunes..Domingo) -> 0..6
        if (!internalDays.includes(internalDay)) internalDays.push(internalDay);
    }
    return internalDays;
}

function joinSpanishList(items) {
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} y ${items[1]}`;
    return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// Confirmación mostrada tras una selección de días válida (sección 8 del
// pedido: "NO agregar otra confirmación Sí/No", sólo informar y seguir).
// Se muestra en orden semanal (Lunes..Domingo) para lectura natural, más
// allá del orden en que el organizador haya tipeado los números.
export function buildWhatsappWeekdaysConfirmationText(internalDays) {
    const sorted = [...internalDays].sort((a, b) => a - b);
    const labels = sorted.map((day) => WHATSAPP_WEEKDAY_LABELS[day]);
    return `✅ Días seleccionados:\n${joinSpanishList(labels)}`;
}

// Horarios recurrentes — mismo prompt/validación de hora ya aprobados en
// Fase 3C/3E (WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT/
// _END_TIME_PROMPT_TEXT/_TIME_INVALID_TEXT), reutilizados tal cual para el
// primer horario. Sólo el prompt de inicio de un horario SIGUIENTE necesita
// texto propio (distingue "el siguiente horario" del primero).
export const WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT =
    `🕐 ¿A qué hora comienza el siguiente horario?\n\nEscribí la hora así:\nHH:MM\n\nEjemplo:\n23:00${WHATSAPP_BACK_HINT_TEXT}`;

export function buildWhatsappRecurringStartTimePromptText(isFirstSchedule) {
    return isFirstSchedule ? WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT : WHATSAPP_RECURRING_START_TIME_NEXT_PROMPT_TEXT;
}

export function buildWhatsappScheduleAddedSummaryText(schedule) {
    return `✅ Horario agregado\n\n${schedule.startTime} a ${schedule.endTime}\n\n¿Querés agregar otro horario?\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.${WHATSAPP_BACK_HINT_TEXT}`;
}

// El motor rechazó el array de horarios ya completo (no debería pasar
// nunca: cada horario ya se validó con los mismos validadores reales antes
// de llegar acá) — nunca se pierden los horarios ya cargados, el pending
// queda intacto en AWAITING_RECURRING_ADD_ANOTHER.
export const WHATSAPP_RECURRING_SCHEDULES_COMMIT_ERROR_TEXT =
    "❌ No pudimos guardar esos horarios.\n\n¿Querés agregar otro horario?\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.";

// Sección 25 del pedido — el rango + días elegidos no generó ninguna fecha
// concreta (ej. rango de un solo día que no cae en ninguno de los días
// elegidos). El motor YA lo detecta por su cuenta: FUNCTIONS_LIST rechaza
// un array vacío (inputHandlers/functionsList.js#parse, "Agregá al menos
// una función.") — acá sólo se traduce a un mensaje claro y recuperable
// (nunca se silencia ni se inventa una función). El step real vigente en
// ese momento ya es FUNCTIONS_LIST (SCHEDULES sí fue aceptado por el
// motor) — "volver" desde ahí lo maneja tal cual el sub-flujo de
// FUNCTIONS_LIST de Fase 3E, sin pending propio en este punto.
export const WHATSAPP_RECURRING_NO_OCCURRENCES_TEXT =
    '❌ No se generó ninguna función con esas fechas y esos días.\n\nEscribí "volver" para ajustar los horarios, los días o el rango de fechas.';

// ==================================================================
// Fase 3G, secciones 2/3 — steps YES_NO (inputType YES_NO: WANTS_FREE_TICKETS,
// PROMO_VIDEO_ASK "YouTube", SOCIAL_LINKS_ASK "redes sociales",
// ADD_ANOTHER_SOCIAL) genéricos, no específicos de YouTube/redes: los
// CUATRO comparten el mismo inputType y el mismo handler real
// (inputHandlers/yesNo.js), que YA acepta booleans directos además de
// "sí"/"si"/"no"/"yes"/"true"/"false" — nunca se duplica esa validación acá,
// sólo se traduce "1"/"2" (la UX que pide el pedido) a `true`/`false` ANTES
// de llamar al motor. Si la respuesta no es "1" ni "2", se deja pasar el
// texto crudo tal cual (compatibilidad con las frases que el handler real
// ya entiende, sin reimplementarlas).
export function resolveWhatsappYesNoReply(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (trimmed === "1") return true;
    if (trimmed === "2") return false;
    return null;
}

// ==================================================================
// Fase 3G, sección 7 — decisión final PUBLICAR/BORRADOR/VOLVER. El motor
// (EventCreationEngine.handlePreviewInput) exige literalmente las acciones
// "PUBLISH"/"DRAFT"/"EDIT"/"BACK" — nunca se le expone ese vocabulario al
// organizador de WhatsApp (ver bug reportado: "Ok"/"Publish" rechazados).
// ==================================================================

const PREVIEW_CHOICE_TO_ACTION = { "1": "PUBLISH", "2": "DRAFT", "3": "BACK" };

export function resolveWhatsappPreviewChoice(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    return PREVIEW_CHOICE_TO_ACTION[trimmed] ?? null;
}

export function buildWhatsappPreviewMenuText() {
    return "¿Qué querés hacer?\n\n1. Publicar evento\n2. Guardar como borrador\n3. Volver y corregir\n\nRespondé con el número de la opción.";
}

export const WHATSAPP_PREVIEW_INVALID_TEXT =
    "❌ Elegí una opción válida.\n\n1. Publicar evento\n2. Guardar como borrador\n3. Volver y corregir\n\nRespondé con el número de la opción.";

// FRONTEND_URL es la misma variable de entorno ya usada (obligatoria) por
// config/resend.js para armar links de recuperación de compra — se lee acá
// directo (sin pasar por getEmailConfig(), que además exige EMAIL_FROM sin
// que haga falta para esto) y de forma tolerante: si no está configurada o
// el evento todavía no tiene `slug`, se omite el link en vez de inventar
// una URL o hacer fallar el mensaje de confirmación.
export function buildWhatsappPublicEventUrl(event) {
    const base = process.env.FRONTEND_URL?.trim()?.replace(/\/+$/, "");
    if (!base || !event?.slug) return null;
    return `${base}/evento/${event.slug}`;
}

// ==================================================================
// Fase 3G, sección 6 — resumen real del evento antes de PREVIEW. Se arma
// EXCLUSIVAMENTE a partir de `prompt.draft` (toPreviewDraft en
// EventCreationEngine.js — el mismo draft real que ya usa Web, nunca un
// segundo modelo de evento). Nada de JSON crudo ni campos técnicos: sólo
// texto legible, con los opcionales ausentes mostrados como "No" o
// simplemente omitidos.
// ==================================================================

function formatWhatsappPriceARS(price) {
    const n = Number(price);
    if (!Number.isFinite(n)) return `$${price}`;
    return `$${n.toLocaleString("es-AR")}`;
}

const SUMMARY_MAX_FUNCTIONS = 10;
const SUMMARY_MAX_TICKET_TYPES = 10;

export function buildWhatsappEventSummaryText(draft) {
    const lines = ["📋 RESUMEN DEL EVENTO", "", `🎭 Nombre: ${draft.title || "Sin nombre"}`];

    if (draft.description) lines.push(`📝 Descripción: ${draft.description}`);
    lines.push(`🖼️ Imagen: ${draft.coverImage ? "Cargada ✅" : "No cargada"}`);

    const locationLines = buildWhatsappLocationSummaryLines(draft.location);
    lines.push(`📍 Lugar: ${locationLines.length ? locationLines.join(", ") : "No cargada"}`);
    const mapsLink = buildWhatsappGoogleMapsLink(draft.location);
    if (mapsLink) lines.push(`🗺️ ${mapsLink}`);

    lines.push("", "📅 Funciones:");
    const functions = draft.functions ?? [];
    if (functions.length === 0) {
        lines.push("Sin funciones cargadas");
    } else {
        for (const fn of functions.slice(0, SUMMARY_MAX_FUNCTIONS)) {
            lines.push(`• ${formatCalendarDateForDisplay(fn.date)} · ${fn.startTime} a ${fn.endTime}`);
        }
        if (functions.length > SUMMARY_MAX_FUNCTIONS) {
            lines.push(`…y ${functions.length - SUMMARY_MAX_FUNCTIONS} función(es) más`);
        }
    }

    lines.push("", "🎟️ Entradas:");
    const ticketTypes = draft.ticketTypes ?? [];
    if (ticketTypes.length === 0) {
        lines.push("Evento gratuito, sin control de acceso");
    } else {
        for (const tt of ticketTypes.slice(0, SUMMARY_MAX_TICKET_TYPES)) {
            lines.push(`• ${tt.name} · ${formatWhatsappPriceARS(tt.price)} · ${tt.quantity} disponibles`);
        }
        if (ticketTypes.length > SUMMARY_MAX_TICKET_TYPES) {
            lines.push(`…y ${ticketTypes.length - SUMMARY_MAX_TICKET_TYPES} tipo(s) más`);
        }
    }

    lines.push("", `🎬 YouTube: ${draft.promoVideoUrl ? "Sí" : "No"}`);
    lines.push(`📱 Redes sociales: ${draft.socialLinks?.length ? "Sí" : "No"}`);

    return lines.join("\n");
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
    return `Hola ${organizationName} 👋 Soy el asistente de PaseCultural. ¿Querés publicar un evento?\n\n1. Sí\n2. No\n\nRespondé con 1 o 2.`;
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
    return `Perfecto. Estás trabajando con ${organizationName}.\n¿Querés publicar un evento?\n\n1. Sí\n2. No\n\nRespondé con 1 o 2.`;
}

// Mientras se espera la confirmación final ("Sí"/"No"/"1"/"2") tras elegir
// una Organization entre varias, cualquier respuesta que no sea afirmativa
// ni negativa vuelve a preguntar sin repetir el selector numerado de
// Organizations (esa ya está resuelta, sólo falta confirmar la intención).
export function buildOrganizationSelectionConfirmationRetryText(organizationName) {
    return `¿Querés publicar un evento con ${organizationName}?\n\n1. Sí\n2. No\n\nRespondé con 1 o 2.`;
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

// Fase 3D, sección 2 — además de las frases textuales de siempre (nunca se
// rompen), el saludo inicial y la confirmación de Organization ahora
// también muestran "1. Sí / 2. No": "1" y "2" se aceptan como equivalentes
// exactos, nunca como índice de ninguna otra lista (este clasificador sólo
// se usa en los dos puntos de decisión Sí/No reales del flujo, nunca donde
// haya un selector numerado de opciones distintas).
export function classifyInitialIntent(text) {
    if (typeof text !== "string") return "UNKNOWN";
    const normalized = normalizeIntentText(text);
    if (!normalized) return "UNKNOWN";
    if (normalized === "1") return "AFFIRMATIVE";
    if (normalized === "2") return "NEGATIVE";
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
// isBackCommand — Fase 3D, sección 7: "volver" retrocede UN sub-paso
// dentro de un WhatsappPendingStepInput (LOCATION/FUNCTIONS_SINGLE_CARD).
// Case-insensitive y tolera espacios externos gracias a normalizeIntentText
// (mismo criterio que isCancelCommand). NUNCA cancela el evento ni borra
// ConversationState — eso sigue siendo exclusivo de "cancelar".
// ==================================================================

const BACK_COMMANDS = new Set(["volver"]);

export function isBackCommand(text) {
    if (typeof text !== "string") return false;
    return BACK_COMMANDS.has(normalizeIntentText(text));
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
    // Fase 3G, sección 7 — la URL pública (si es derivable, ver
    // buildWhatsappPublicEventUrl) reemplaza el mensaje genérico de antes;
    // nunca se inventa un link si no hay FRONTEND_URL o slug.
    if (engineResult.done) {
        if (engineResult.status === "PUBLISHED") {
            const url = buildWhatsappPublicEventUrl(engineResult.event);
            return url ? `✅ Evento publicado correctamente.\n\n${url}` : "✅ Evento publicado correctamente.";
        }
        return "✅ Evento guardado como borrador.\n\nPara editarlo o publicarlo más adelante, ingresá a la web de PaseCultural.";
    }

    const prompt = engineResult.prompt;
    if (!prompt) return null;

    // Fase 3G, sección 6/7 — resumen real del evento (a partir del MISMO
    // draft que ya usa Web, `prompt.draft`, ver toPreviewDraft en
    // EventCreationEngine.js) + menú 1/2/3, en reemplazo del texto genérico
    // ("terminá de revisarlo desde la web") que no servía para este
    // objetivo. tryHandlePreviewSubflow (whatsapp.controller.js) es quien
    // INTERCEPTA la respuesta del organizador y la traduce a la acción real
    // del motor — acá sólo se arma el texto, se re-muestra igual la primera
    // vez que en cualquier reintento (con o sin `prompt.error`).
    if (prompt.type === "PREVIEW") {
        const summary = buildWhatsappEventSummaryText(prompt.draft);
        const menu = buildWhatsappPreviewMenuText();
        return prompt.error ? `⚠️ ${prompt.error}\n\n${summary}\n\n${menu}` : `${summary}\n\n${menu}`;
    }

    // type === "QUESTION", inputType YES_NO — Fase 3G, secciones 2/3/5:
    // WANTS_FREE_TICKETS/PROMO_VIDEO_ASK/SOCIAL_LINKS_ASK/ADD_ANOTHER_SOCIAL
    // comparten el mismo inputType. El motor sigue devolviendo únicamente
    // `text` (nunca `options`, a diferencia de SINGLE_SELECT) — acá se
    // agrega la numeración 1/2 y el recordatorio de VOLVER de forma
    // genérica para los cuatro, no sólo para YouTube/redes.
    if (prompt.inputType === "YES_NO") {
        const yesNoText = prompt.error ? `⚠️ ${prompt.error}\n\n${prompt.text}` : prompt.text;
        return `${yesNoText}\n\n1. Sí\n2. No\n\nRespondé con el número de la opción.${WHATSAPP_BACK_HINT_TEXT}`;
    }

    // type === "QUESTION", step LOCATION — Fase 3D: esto SÓLO se alcanza la
    // primera vez que el motor avanza a este step (ej. justo después de
    // subir la imagen de portada), nunca durante el sub-flujo en sí (método
    // → compartir/manual → calle/altura/ciudad/provincia) — eso lo maneja
    // enteramente tryHandleLocationSubflow en whatsapp.controller.js, sin
    // volver a pasar por acá. Reemplaza el prompt genérico (pensado para el
    // picker de Google Maps de la Web) por la primera pregunta del
    // sub-flujo: cómo cargar la ubicación.
    if (prompt.inputType === "LOCATION") {
        return WHATSAPP_LOCATION_METHOD_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_SINGLE_CARD — Fase 3C: esto SÓLO
    // se alcanza la primera vez que el motor avanza a este step (ej. justo
    // después de responder "Una sola función" en FUNCTIONS_MODE), nunca
    // durante el sub-flujo de 3 preguntas en sí (fecha/hora inicio/hora
    // fin) — eso lo maneja enteramente tryHandleFunctionCardSubflow en
    // whatsapp.controller.js, sin volver a pasar por acá. Reemplaza el
    // prompt genérico ("Contame cuándo es la función.", pensado para el
    // formulario compuesto de la Web) por la primera pregunta del
    // sub-flujo: la fecha.
    if (prompt.inputType === "FUNCTION_CARD") {
        return WHATSAPP_FUNCTION_CARD_DATE_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_LIST — Fase 3E: esto SÓLO se
    // alcanza la primera vez que el motor avanza a este step viniendo de
    // FUNCTIONS_MODE con "Varias funciones" (nunca durante el sub-flujo en
    // sí, que maneja enteramente tryHandleFunctionsListSubflow). Reemplaza
    // el prompt genérico ("Administrador de Agenda", pensado para la UI
    // Web) por la primera pregunta del sub-flujo: la fecha de la primera
    // función.
    if (prompt.inputType === "FUNCTIONS_LIST") {
        return WHATSAPP_FUNCTIONS_LIST_DATE_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_RANGE (RECURRING) — Fase 3F: sólo
    // se alcanza la primera vez que el motor avanza a este step (después de
    // "Funciones recurrentes" en FUNCTIONS_MODE, o al volver acá desde
    // WEEKDAYS) — el sub-flujo de rango en sí (desde/hasta) lo maneja
    // enteramente tryHandleRecurringRangeSubflow.
    if (prompt.inputType === "DATE_RANGE") {
        return WHATSAPP_RECURRING_FROM_DATE_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_WEEKDAYS — Fase 3F: sólo la
    // primera vez que el motor avanza a este step (tras completar el
    // rango, o al volver acá desde SCHEDULES).
    if (prompt.inputType === "WEEKDAYS") {
        return WHATSAPP_RECURRING_WEEKDAYS_PROMPT_TEXT;
    }

    // type === "QUESTION", step FUNCTIONS_RECURRING_SCHEDULES — Fase 3F:
    // sólo la primera vez que el motor avanza a este step (tras completar
    // los días). Reutiliza tal cual el prompt de hora de inicio ya
    // aprobado en Fase 3C — misma pregunta, mismo validador.
    if (prompt.inputType === "TIME_RANGE_LIST") {
        return WHATSAPP_FUNCTION_CARD_START_TIME_PROMPT_TEXT;
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
