// Única fuente de verdad de todos los errores de la aplicación. Cada
// entrada define, para UN código de negocio, su status HTTP, el mensaje
// técnico que va a los logs y el mensaje que ve el usuario final.
//
// Agregar un error nuevo es agregar UNA entrada acá — no hay que tocar
// ningún otro archivo: ErrorCodes.js se deriva automáticamente de las
// claves de este objeto (ver ErrorCodes.js).
//
// El código (la clave) es el contrato estable con el frontend
// (`error.code`): una vez publicado no se renombra. El `userMessage` sí
// puede reescribirse libremente con el tiempo sin romper nada del lado
// cliente. Un mismo código debe representar siempre una única condición de
// negocio — si dos contextos son funcionalmente distintos, van con dos
// códigos distintos aunque hoy compartan texto.
export const ErrorCatalog = Object.freeze({
    INTERNAL_ERROR: {
        httpStatus: 500,
        logMessage: "Unhandled internal error.",
        userMessage: "Ocurrió un error inesperado. Intentá nuevamente en unos minutos.",
    },

    // --- Sales / Tickets / Scanner --------------------------------------
    USER_NOT_FOUND: {
        httpStatus: 401,
        logMessage: "Authenticated Clerk user has no matching User row.",
        userMessage: "Usuario no sincronizado. Volvé a iniciar sesión.",
    },
    EVENT_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Event not found.",
        userMessage: "El evento no existe.",
    },
    FUNCTION_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Event function not found or does not belong to the given event.",
        userMessage: "La función seleccionada no existe para este evento.",
    },
    SALE_ITEMS_REQUIRED: {
        httpStatus: 400,
        logMessage: "Sale creation attempted with no items.",
        userMessage: "Tenés que elegir al menos una entrada.",
    },
    GUEST_BUYER_INFO_REQUIRED: {
        httpStatus: 400,
        logMessage: "Guest checkout attempted without firstName/lastName/email.",
        userMessage: "Ingresá tu nombre, apellido y email para continuar.",
    },
    GUEST_BUYER_INVALID_EMAIL: {
        httpStatus: 400,
        logMessage: "Guest checkout attempted with an invalid email.",
        userMessage: "El email ingresado no es válido.",
    },
    INVALID_SALE_ITEM: {
        httpStatus: 400,
        logMessage: "Sale item has an invalid ticketTypeId or quantity.",
        userMessage: "Alguna de las entradas elegidas tiene una cantidad inválida.",
    },
    TICKET_TYPE_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "TicketType not found, not linked to the event, or not assigned to the given function.",
        userMessage: "Una de las entradas elegidas no está disponible para esta función.",
    },
    TICKET_TYPE_NOT_AVAILABLE: {
        httpStatus: 400,
        logMessage: "TicketType assignment for this function is disabled.",
        userMessage: "Una de las entradas elegidas no está disponible para esta función.",
    },
    INSUFFICIENT_STOCK: {
        httpStatus: 409,
        logMessage: "Requested quantity exceeds remaining stock for this ticket type/function.",
        userMessage: "No hay suficiente stock disponible para la cantidad solicitada.",
    },
    SALE_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Sale not found, or does not belong to the requesting user/organization.",
        userMessage: "La venta no existe.",
    },
    SALE_NOT_PENDING: {
        httpStatus: 409,
        logMessage: "Sale is not in PENDING status, cannot confirm/cancel.",
        userMessage: "Esta venta ya fue procesada.",
    },
    SALE_ALREADY_PROCESSED: {
        httpStatus: 409,
        logMessage: "Concurrent confirmSale() call lost the race: sale was no longer PENDING.",
        userMessage: "Esta venta ya fue confirmada.",
    },
    TICKET_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Ticket not found.",
        userMessage: "La entrada no existe.",
    },
    TICKET_FORBIDDEN: {
        httpStatus: 403,
        logMessage: "Requesting user is not the owner of this ticket.",
        userMessage: "No tenés permiso para acceder a esta entrada.",
    },
    SCANNER_NOT_AUTHORIZED: {
        httpStatus: 403,
        logMessage: "Scanner user is not assigned (or not active) for this event.",
        userMessage: "No estás habilitado como scanner para este evento.",
    },
    SCAN_ATTEMPTS_EVENT_REQUIRED: {
        httpStatus: 400,
        logMessage: "eventId query param is required to list scan attempts.",
        userMessage: "Falta indicar el evento para ver el historial.",
    },
    EVENT_SCANNER_EMAIL_REQUIRED: {
        httpStatus: 400,
        logMessage: "Email is required to add an event scanner.",
        userMessage: "Ingresá el email de la persona que querés habilitar.",
    },
    EVENT_SCANNER_USER_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "No User exists with the given email — can't be added as an event scanner.",
        userMessage: "Ese email todavía no tiene una cuenta en PaseCultural. Pedile que se registre primero.",
    },
    EVENT_SCANNER_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "EventScanner assignment not found (or already inactive) for this event/user pair.",
        userMessage: "Esa persona no está habilitada como scanner de este evento.",
    },
});
