// Traducción de los códigos de error que lanza EventService (backend/src/services/event.service.js)
// a mensajes legibles. Es el mismo mapeo que usaba event.controller.js para las respuestas HTTP;
// se centraliza acá para que tanto el controller REST como el EventServicePort del
// Event Creation Engine devuelvan exactamente el mismo mensaje ante el mismo error.
export const EVENT_SERVICE_ERROR_MESSAGES = {
    NO_ORGANIZATION: "Necesitás una organización aprobada para crear eventos",
    TITLE_REQUIRED: "El nombre del evento es obligatorio",
    CUSTOM_CATEGORY_REQUIRED: 'Especificá el nombre de la categoría cuando elegís "Otro"',
    INVALID_LATITUDE: "La latitud de la ubicación no es válida",
    INVALID_LONGITUDE: "La longitud de la ubicación no es válida",
    ORGANIZATION_NOT_APPROVED:
        "Tu organización todavía no fue aprobada. Podés preparar el evento, pero no publicarlo hasta que un Developer la apruebe.",
    NO_FUNCTIONS: "El evento necesita al menos una función para poder publicarse",
    NO_TICKET_TYPES: "El evento necesita al menos una entrada en el catálogo para poder publicarse",
    TICKET_TYPE_WITHOUT_PRICE: "Todas las entradas del catálogo necesitan un precio",
    TICKET_TYPE_WITHOUT_QUANTITY: "Todas las entradas del catálogo necesitan una cantidad disponible",
    FUNCTION_WITHOUT_TICKET_ASSIGNMENTS:
        "Todas las funciones necesitan al menos una entrada asignada para poder publicarse",
    LOCATION_MISSING_VENUE_NAME: "El evento necesita un nombre de lugar para poder publicarse",
    LOCATION_MISSING_ADDRESS: "El evento necesita una dirección para poder publicarse",
    FUNCTION_MISSING_FIELDS: "Cada función necesita fecha y lugar",
    TICKET_TYPE_MISSING_FIELDS: "Cada entrada del catálogo necesita nombre, precio y cantidad",
    LINK_MISSING_FIELDS: "Cada enlace necesita un tipo y una URL",
    LINK_INVALID_URL: "Una de las URLs cargadas no es válida",
    LINK_INVALID_VIDEO: "Ese enlace de YouTube no tiene un video válido. Revisá la URL.",
    LINK_DUPLICATE_URL: "No podés cargar la misma URL dos veces en el mismo evento",
};

export function translateEventServiceError(error) {
    return EVENT_SERVICE_ERROR_MESSAGES[error?.message] ?? null;
}
