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
    GUEST_BUYER_DOCUMENT_REQUIRED: {
        httpStatus: 400,
        logMessage: "Guest checkout attempted without buyerDocument.",
        userMessage: "Ingresá tu DNI para continuar.",
    },
    RECOVER_INFO_REQUIRED: {
        httpStatus: 400,
        logMessage: "Purchase recovery attempted without both email and buyerDocument.",
        userMessage: "Ingresá tu email y tu DNI para buscar tu compra.",
    },
    GUEST_BUYER_INVALID_DOCUMENT: {
        httpStatus: 400,
        logMessage: "Guest checkout attempted with an invalid buyerDocument (must be 7-10 digits).",
        userMessage: "El DNI ingresado no es válido. Tiene que tener entre 7 y 10 números.",
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
    SALE_NOT_CONFIRMED: {
        httpStatus: 409,
        logMessage: "Cannot (re)send the confirmation email for a sale that is not CONFIRMED.",
        userMessage: "Esta venta todavía no está confirmada.",
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
    TICKET_INVALID_TRANSITION: {
        httpStatus: 409,
        logMessage: "Ticket status change attempted from a status that does not allow it.",
        userMessage: "No se puede completar esa acción en el estado actual de la entrada.",
    },
    SCANNER_NOT_AUTHORIZED: {
        httpStatus: 403,
        logMessage: "Scanner user is not assigned (or not active) for this event.",
        userMessage: "No estás habilitado como scanner para este evento.",
    },
    SCANNER_SESSION_INVALID: {
        httpStatus: 401,
        logMessage: "Scanner session token missing, malformed, expired, or no longer ACTIVE.",
        userMessage: "Tu sesión de scanner venció o ya no es válida. Pedile al organizador un enlace de invitación nuevo.",
    },
    SCAN_ATTEMPTS_EVENT_REQUIRED: {
        httpStatus: 400,
        logMessage: "eventId query param is required to list scan attempts.",
        userMessage: "Falta indicar el evento para ver el historial.",
    },
    EVENT_SCANNER_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "EventScanner row not found (or deleted) for this event.",
        userMessage: "Ese scanner no existe en este evento.",
    },
    SCANNER_GATE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Gate/door name is required to create scanner invitations.",
        userMessage: "Indicá qué puerta o acceso va a cubrir.",
    },
    SCANNER_QUANTITY_INVALID: {
        httpStatus: 400,
        logMessage: "Scanner invitation quantity must be an integer between 1 and 20.",
        userMessage: "La cantidad tiene que ser un número entre 1 y 20.",
    },
    SCANNER_INVALID_TRANSITION: {
        httpStatus: 409,
        logMessage: "Scanner status change attempted from a status that does not allow it.",
        userMessage: "No se puede completar esa acción en el estado actual del scanner.",
    },
    SCANNER_INVITATION_NOT_ELIGIBLE: {
        httpStatus: 409,
        logMessage: "Invitation regeneration attempted on a scanner row not in INVITED/REVOKED status.",
        userMessage: "No se puede generar una nueva invitación para este scanner en su estado actual.",
    },
    SCANNER_INVITATION_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Scanner invitation token not found or deleted.",
        userMessage: "Esta invitación no existe o ya no es válida.",
    },
    SCANNER_INVITATION_EXPIRED: {
        httpStatus: 410,
        logMessage: "Scanner invitation token has expired.",
        userMessage: "Esta invitación venció. Pedile al organizador que te mande una nueva.",
    },
    SCANNER_INVITATION_REVOKED: {
        httpStatus: 410,
        logMessage: "Scanner invitation was revoked before being claimed.",
        userMessage: "Esta invitación fue cancelada por el organizador.",
    },
    SCANNER_INVITATION_ALREADY_CLAIMED: {
        httpStatus: 409,
        logMessage: "Scanner invitation already claimed by a different user.",
        userMessage: "Esta invitación ya fue aceptada por otra persona.",
    },
    SCANNER_INVITATION_ALREADY_ASSIGNED: {
        httpStatus: 409,
        logMessage: "User already has a non-revoked EventScanner row for this event.",
        userMessage: "Ya estás asignado como scanner en este evento.",
    },
    SCANNER_REGISTRATION_INFO_REQUIRED: {
        httpStatus: 400,
        logMessage: "Scanner registration attempted without firstName/lastName/document/email.",
        userMessage: "Completá nombre, apellido, DNI y correo para continuar.",
    },
    SCANNER_REGISTRATION_INVALID_EMAIL: {
        httpStatus: 400,
        logMessage: "Scanner registration attempted with an invalid email.",
        userMessage: "El email ingresado no es válido.",
    },
    SCANNER_REGISTRATION_INVALID_DOCUMENT: {
        httpStatus: 400,
        logMessage: "Scanner registration attempted with an invalid document (must be 7-10 digits).",
        userMessage: "El DNI ingresado no es válido. Tiene que tener entre 7 y 10 números.",
    },
    SCANNER_VERIFICATION_NOT_REQUESTED: {
        httpStatus: 409,
        logMessage: "Code verification attempted before registering (no verification code was ever sent).",
        userMessage: "Todavía no pediste un código. Completá el registro primero.",
    },
    SCANNER_VERIFICATION_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Code verification attempted without a code.",
        userMessage: "Ingresá el código que te mandamos por correo.",
    },
    SCANNER_VERIFICATION_CODE_INVALID: {
        httpStatus: 400,
        logMessage: "Code verification attempted with a code that does not match the stored hash.",
        userMessage: "El código ingresado es incorrecto.",
    },
    SCANNER_VERIFICATION_CODE_EXPIRED: {
        httpStatus: 410,
        logMessage: "Code verification attempted after the code's expiration.",
        userMessage: "Ese código venció. Pedí uno nuevo.",
    },
    SCANNER_VERIFICATION_TOO_MANY_ATTEMPTS: {
        httpStatus: 429,
        logMessage: "Code verification attempted after exceeding the max allowed attempts for the current code.",
        userMessage: "Superaste el máximo de intentos. Pedí un código nuevo.",
    },
    SCANNER_VERIFICATION_RESEND_TOO_SOON: {
        httpStatus: 429,
        logMessage: "Verification code (re)send attempted before the resend cooldown elapsed.",
        userMessage: "Esperá unos segundos antes de pedir otro código.",
    },
    SCANNER_VERIFICATION_EMAIL_FAILED: {
        httpStatus: 502,
        logMessage: "Failed to send the scanner verification code email via Resend.",
        userMessage: "No pudimos enviar el código. Probá de nuevo en unos segundos.",
    },

    // --- Recuperación de compra (segundo factor por código) -------------
    // No hay un código "no pediste un código todavía" ni "reenvío
    // demasiado pronto" ni "falló el envío": esos casos se absorben en una
    // respuesta 200 genérica (ver saleRecoveryVerification.service.js) para
    // no crear un canal lateral que revele si un email/DNI existen.
    RECOVER_VERIFICATION_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Sale recovery code verification attempted without a code.",
        userMessage: "Ingresá el código que te mandamos por correo.",
    },
    RECOVER_VERIFICATION_CODE_INVALID: {
        httpStatus: 400,
        logMessage: "Sale recovery code verification attempted with a code that does not match the stored hash, or no verification session exists for this email+document pair (deliberately indistinguishable from a wrong code).",
        userMessage: "El código ingresado es incorrecto.",
    },
    RECOVER_VERIFICATION_CODE_EXPIRED: {
        httpStatus: 410,
        logMessage: "Sale recovery code verification attempted after the code's expiration.",
        userMessage: "Ese código venció. Pedí uno nuevo.",
    },
    RECOVER_VERIFICATION_TOO_MANY_ATTEMPTS: {
        httpStatus: 429,
        logMessage: "Sale recovery code verification attempted after exceeding the max allowed attempts for the current code.",
        userMessage: "Superaste el máximo de intentos. Pedí un código nuevo.",
    },

    // --- Portal Scanner (login recurrente por email + código) -----------
    // El resto de los códigos de este flujo reusa la familia
    // SCANNER_VERIFICATION_* de arriba (mismo texto sirve para registro y
    // para login) — sólo estos dos son nuevos y propios del login.
    SCANNER_LOGIN_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Scanner portal login attempted for an email with no ACTIVE EventScanner row.",
        userMessage: "No encontramos un acceso habilitado.",
    },
    SCANNER_LOGIN_INVALID_EMAIL: {
        httpStatus: 400,
        logMessage: "Scanner portal login attempted with an invalid email.",
        userMessage: "Ingresá un email válido.",
    },

    // --- Developer / Base de Datos (sólo entorno de desarrollo) ---------
    // Herramienta exclusiva para limpiar/sembrar la base de datos de
    // desarrollo (ver devTools.service.js) — nunca debe poder ejecutarse en
    // producción, ver DEV_TOOLS_UNAVAILABLE.
    DEV_TOOLS_UNAVAILABLE: {
        httpStatus: 403,
        logMessage: "Developer database tool invoked outside a non-production environment.",
        userMessage: "Esta herramienta no está disponible en este entorno.",
    },
    DEV_TOOLS_CONFIRMATION_REQUIRED: {
        httpStatus: 400,
        logMessage: "Dev database reset attempted without the exact confirmation phrase.",
        userMessage: "Confirmación inválida. Esta acción requiere confirmarse explícitamente.",
    },
    DEV_TOOLS_NO_ORGANIZATION: {
        httpStatus: 409,
        logMessage: "Demo event creation attempted with zero organizations in the database.",
        userMessage: "No hay ninguna organización en la base todavía — creá una antes de generar el evento demo.",
    },

    // --- Historial de Eventos (archivado automático) --------------------
    EVENT_ARCHIVED: {
        httpStatus: 409,
        logMessage: "Operation attempted on an archived event through an operational (non-history) endpoint.",
        userMessage: "Este evento ya pasó al Historial de Eventos. Restauralo primero si necesitás operarlo, o duplicalo para crear uno nuevo.",
    },
});
