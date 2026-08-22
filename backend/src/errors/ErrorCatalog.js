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
    MAX_PER_PURCHASE_EXCEEDED: {
        httpStatus: 400,
        logMessage: "Requested quantity exceeds maxPerPurchase for this ticket type.",
        userMessage: "La cantidad solicitada supera el máximo permitido por compra para una de las entradas elegidas.",
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
    SALE_EMAIL_RESEND_FAILED: {
        httpStatus: 502,
        logMessage: "sendSaleConfirmationEmail resolved with status FAILED on a manual resend attempt.",
        userMessage: "No pudimos reenviar el correo. Probá de nuevo en unos minutos.",
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

    // --- Botón de arrepentimiento (WithdrawalRequest) --------------------
    // Mismo criterio de no-enumeración que la familia RECOVER_* de arriba:
    // ninguno de estos códigos distingue "el par no existe" de "el código
    // es incorrecto" — ver withdrawalRequestVerification.service.js.
    WITHDRAWAL_INFO_REQUIRED: {
        httpStatus: 400,
        logMessage: "Withdrawal request OTP requested without both email and buyerDocument.",
        userMessage: "Ingresá tu email y tu DNI para continuar.",
    },
    WITHDRAWAL_VERIFICATION_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Withdrawal request OTP verification attempted without a code.",
        userMessage: "Ingresá el código que te mandamos por correo.",
    },
    WITHDRAWAL_VERIFICATION_CODE_INVALID: {
        httpStatus: 400,
        logMessage: "Withdrawal request OTP verification attempted with a code that does not match the stored hash, or no verification session exists for this email+document pair (deliberately indistinguishable from a wrong code).",
        userMessage: "El código ingresado es incorrecto.",
    },
    WITHDRAWAL_VERIFICATION_CODE_EXPIRED: {
        httpStatus: 410,
        logMessage: "Withdrawal request OTP verification attempted after the code's expiration.",
        userMessage: "Ese código venció. Pedí uno nuevo.",
    },
    WITHDRAWAL_VERIFICATION_TOO_MANY_ATTEMPTS: {
        httpStatus: 429,
        logMessage: "Withdrawal request OTP verification attempted after exceeding the max allowed attempts for the current code.",
        userMessage: "Superaste el máximo de intentos. Pedí un código nuevo.",
    },
    // A diferencia de los códigos de arriba, éste SÍ puede ser específico:
    // el token acá no es un par de datos personales adivinable, es un
    // secreto de alta entropía que sólo el propio navegador vio recién
    // después de superar el OTP — mismo criterio que SALE_NOT_FOUND en
    // confirmSaleByBuyer.
    WITHDRAWAL_REQUEST_SALE_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Withdrawal request attempted with a token that doesn't resolve to any Sale.",
        userMessage: "No encontramos esa compra.",
    },
    WITHDRAWAL_REQUEST_NOT_ELIGIBLE: {
        httpStatus: 409,
        logMessage: "Withdrawal request attempted against a Sale that isn't in a technically eligible state (not CONFIRMED, or every ticket already REFUNDED).",
        userMessage: "Esta compra no está disponible para una solicitud en este momento.",
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

    // --- Cortesías --------------------------------------------------------
    COURTESY_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "CourtesyIssuance not found, or its Sale does not belong to the requesting organizer.",
        userMessage: "La cortesía no existe.",
    },
    COURTESY_DELIVERY_METHOD_INVALID: {
        httpStatus: 400,
        logMessage: "Courtesy issuance attempted with a deliveryMethod other than SHARE/EMAIL.",
        userMessage: "Elegí cómo entregar la cortesía: compartir o enviar por correo.",
    },
    COURTESY_RECIPIENT_EMAIL_REQUIRED: {
        httpStatus: 400,
        logMessage: "Courtesy issuance with deliveryMethod=EMAIL attempted without a recipientEmail.",
        userMessage: "Ingresá el correo electrónico del destinatario.",
    },

    // --- WhatsApp (Fase 2C — envío de prueba desde Developer → Base de Datos) ---
    WHATSAPP_RECIPIENT_REQUIRED: {
        httpStatus: 400,
        logMessage: "WhatsApp test-send attempted without a recipient phone number.",
        userMessage: "Ingresá el número de teléfono destino.",
    },
    WHATSAPP_SEND_FAILED: {
        httpStatus: 502,
        logMessage: "Meta Graph API rejected or failed to deliver the WhatsApp message.",
        userMessage: "No pudimos enviar el mensaje de WhatsApp. Revisá el error de Meta en los logs.",
    },

    // --- WhatsApp Organizer Link (Fase 2F — vinculación wa_id ↔ organizer) ---
    WHATSAPP_LINK_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "WhatsApp organizer link attempted without a code.",
        userMessage: "Ingresá el código que te mandamos por WhatsApp.",
    },
    WHATSAPP_LINK_CODE_INVALID: {
        httpStatus: 400,
        logMessage: "WhatsApp organizer link attempted with a code that matches no live challenge (deliberately indistinguishable from a code that never existed).",
        userMessage: "El código ingresado es incorrecto.",
    },
    WHATSAPP_LINK_CODE_EXPIRED: {
        httpStatus: 410,
        logMessage: "WhatsApp organizer link attempted after the challenge's expiration.",
        userMessage: "Ese código venció. Volvé a escribirle al bot de WhatsApp para pedir uno nuevo.",
    },
    WHATSAPP_LINK_TOO_MANY_ATTEMPTS: {
        httpStatus: 429,
        logMessage: "WhatsApp organizer link attempted after the organization exceeded the max allowed failed attempts within the current window.",
        userMessage: "Superaste el máximo de intentos. Esperá unos minutos y volvé a intentarlo.",
    },
    WHATSAPP_LINK_NO_ORGANIZATION: {
        httpStatus: 409,
        logMessage: "WhatsApp organizer link attempted by a Clerk user with no Organization row.",
        userMessage: "Todavía no tenés una organización creada.",
    },
    WHATSAPP_ALREADY_LINKED: {
        httpStatus: 409,
        logMessage: "WhatsApp organizer link attempted but this organization already has a verified WhatsApp link.",
        userMessage: "Tu organización ya tiene un WhatsApp vinculado.",
    },
    WHATSAPP_LINK_WAID_ALREADY_LINKED: {
        httpStatus: 409,
        logMessage: "WhatsApp organizer link attempted for a wa_id that got linked to a different organization between the challenge lookup and the commit (unique constraint race).",
        userMessage: "Ese WhatsApp ya está vinculado a otra organización.",
    },

    // WHATSAPP_NUMBER_CHANGE_* (cambio de número de WhatsApp autorizado por
    // OTP-vía-WhatsApp) fueron RETIRADOS junto con whatsappNumberChange.service.js
    // — ver el informe de entrega "unificación WhatsApp".

    // --- Verificación de teléfono/WhatsApp de Organización (Organization.phone) ---
    ORGANIZATION_PHONE_ORGANIZATION_REQUIRED: {
        httpStatus: 400,
        logMessage: "Organization phone verification attempted without an organizationId.",
        userMessage: "Falta indicar la organización.",
    },
    ORGANIZATION_PHONE_FORBIDDEN: {
        httpStatus: 403,
        logMessage: "Organization phone verification attempted by a user who does not own the given organization.",
        userMessage: "No tenés permiso para modificar el teléfono de esta organización.",
    },
    ORGANIZATION_PHONE_INVALID_NUMBER: {
        httpStatus: 400,
        logMessage: "Organization phone verification requested with a phone number that could not be parsed unambiguously as an Argentine mobile number.",
        userMessage: "Ingresá un número de WhatsApp argentino válido.",
    },
    ORGANIZATION_PHONE_SAME_NUMBER: {
        httpStatus: 400,
        logMessage: "Organization phone verification requested with the same number that is already verified for this organization.",
        userMessage: "Ese ya es tu número verificado.",
    },
    ORGANIZATION_PHONE_RESEND_TOO_SOON: {
        httpStatus: 429,
        logMessage: "Organization phone verification challenge (re)issue attempted before the reissue cooldown elapsed (WhatsApp deep link), or the email OTP resend cooldown elapsed.",
        userMessage: "Esperá unos segundos antes de reintentar.",
    },
    ORGANIZATION_PHONE_SEND_FAILED: {
        httpStatus: 502,
        logMessage: "WHATSAPP_DISPLAY_PHONE_NUMBER is missing/misconfigured — could not build the organization phone verification wa.me deep link.",
        userMessage: "No pudimos generar el enlace de verificación por WhatsApp. Probá de nuevo en unos minutos.",
    },
    ORGANIZATION_PHONE_EMAIL_SEND_FAILED: {
        httpStatus: 502,
        logMessage: "Resend failed to deliver the organization phone change authorization OTP email.",
        userMessage: "No pudimos enviar el código a tu email. Probá de nuevo en unos minutos.",
    },
    ORGANIZATION_PHONE_VERIFICATION_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Organization phone WhatsApp verification resend attempted with no live pending verification for this organization.",
        userMessage: "No encontramos una verificación de WhatsApp pendiente. Iniciá el proceso de nuevo.",
    },
    ORGANIZATION_PHONE_OTP_NOT_FOUND: {
        httpStatus: 404,
        logMessage: "Organization phone change email OTP verification/resend attempted with no live authorization for this organization.",
        userMessage: "No encontramos un cambio de teléfono pendiente. Pedí un código nuevo.",
    },
    ORGANIZATION_PHONE_OTP_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Organization phone change email OTP verification attempted without a well-formed 6-digit code.",
        userMessage: "Ingresá el código de 6 dígitos.",
    },
    ORGANIZATION_PHONE_OTP_CODE_INVALID: {
        httpStatus: 400,
        logMessage: "Organization phone change email OTP verification attempted with a code that does not match the stored hash.",
        userMessage: "El código ingresado es incorrecto.",
    },
    ORGANIZATION_PHONE_OTP_CODE_EXPIRED: {
        httpStatus: 410,
        logMessage: "Organization phone change email OTP verification attempted after the authorization's expiration.",
        userMessage: "Ese código venció. Pedí uno nuevo.",
    },
    ORGANIZATION_PHONE_OTP_TOO_MANY_ATTEMPTS: {
        httpStatus: 429,
        logMessage: "Organization phone change email OTP verification attempted after exceeding the max allowed failed attempts for the current authorization.",
        userMessage: "Superaste el máximo de intentos. Pedí un código nuevo.",
    },
    ORGANIZATION_PHONE_OTP_ALREADY_RESOLVED: {
        httpStatus: 409,
        logMessage: "Organization phone change email OTP verification attempted after the authorization was already consumed (or removed) by a concurrent request.",
        userMessage: "Este cambio ya se resolvió. Si todavía lo necesitás, pedí un código nuevo.",
    },

    // --- Mercado Pago OAuth (MP-1 — onboarding, sin cobros todavía) -----
    MERCADOPAGO_ORGANIZATION_REQUIRED: {
        httpStatus: 400,
        logMessage: "Mercado Pago connection attempted without an organizationId.",
        userMessage: "Falta indicar la organización.",
    },
    MERCADOPAGO_FORBIDDEN: {
        httpStatus: 403,
        logMessage: "Mercado Pago connection attempted by a user who does not own the given organization.",
        userMessage: "No tenés permiso para conectar Mercado Pago en esta organización.",
    },
    MERCADOPAGO_STATE_INVALID: {
        httpStatus: 400,
        logMessage: "Mercado Pago OAuth callback received a state value that does not match any live authorization attempt (never existed, or already consumed).",
        userMessage: "No pudimos validar la conexión con Mercado Pago. Volvé a intentarlo desde Configuración.",
    },
    MERCADOPAGO_STATE_EXPIRED: {
        httpStatus: 410,
        logMessage: "Mercado Pago OAuth callback received after the state's expiration window.",
        userMessage: "El intento de conexión venció. Volvé a intentarlo desde Configuración.",
    },
    MERCADOPAGO_CODE_REQUIRED: {
        httpStatus: 400,
        logMessage: "Mercado Pago OAuth callback received without an authorization code.",
        userMessage: "No pudimos completar la conexión con Mercado Pago.",
    },
    MERCADOPAGO_EXCHANGE_FAILED: {
        httpStatus: 502,
        logMessage: "Mercado Pago rejected, failed, or returned an incomplete authorization-code exchange.",
        userMessage: "No pudimos completar la conexión con Mercado Pago. Probá de nuevo en unos minutos.",
    },

    // --- Mercado Pago Checkout Pro + Split Payment (MP-2) ---
    MERCADOPAGO_NOT_CONNECTED: {
        httpStatus: 409,
        logMessage: "Checkout attempted for an event whose organization has no Mercado Pago connection.",
        userMessage: "Este organizador todavía no habilitó el cobro con Mercado Pago. Contactalo para completar tu compra.",
    },
    MERCADOPAGO_TOKEN_REFRESH_FAILED: {
        httpStatus: 502,
        logMessage: "Mercado Pago access token was expired/near expiry and the refresh attempt failed.",
        userMessage: "No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en unos minutos.",
    },
    MERCADOPAGO_ITEMS_MISMATCH: {
        httpStatus: 500,
        logMessage: "The sum of the items built for Mercado Pago does not match the Sale's own total — aborted before calling Mercado Pago.",
        userMessage: "No pudimos procesar tu compra. Probá de nuevo.",
    },
    MERCADOPAGO_PREFERENCE_FAILED: {
        httpStatus: 502,
        logMessage: "Mercado Pago rejected, failed, or returned an incomplete Checkout Pro preference creation.",
        userMessage: "No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en unos minutos.",
    },
    MERCADOPAGO_CHECKOUT_ALREADY_ATTEMPTED: {
        httpStatus: 409,
        logMessage: "A checkout was already attempted (or is being attempted concurrently) with this idempotency key, with no usable preference to replay.",
        userMessage: "Ya estamos procesando (o ya procesamos) este intento de compra. Si no avanzó, volvé a intentarlo desde el principio.",
    },

    // --- Comisión de servicio (MP-6) ---
    SERVICE_FEE_CONFIG_MISSING: {
        httpStatus: 500,
        logMessage: "No valid ServiceFeeTier configuration exists (empty, or fails validation) — refusing to create a Mercado Pago checkout with an accidental zero/undefined service fee.",
        userMessage: "No pudimos procesar tu compra. Probá de nuevo.",
    },
    SERVICE_FEE_TIERS_INVALID: {
        httpStatus: 400,
        logMessage: "The proposed service fee tier set failed validation (negative amounts, overlaps, gaps, inverted range, missing/duplicate open-ended tier, or empty set).",
        userMessage: "La configuración de comisión tiene errores. Revisá los rangos e intentá de nuevo.",
    },
    // Protección optimista (ronda de endurecimiento) — el desglose que el
    // comprador confirmó en el Wizard (ticketsSubtotal/serviceFee/total)
    // ya no coincide con el cálculo autoritativo recién hecho (precio de
    // alguna entrada y/o rangos de comisión cambiaron entre el resumen y
    // este request). Se aborta ANTES de reservar stock o crear la Sale —
    // ver createSaleForBuyer, sale.service.js. `details` siempre lleva el
    // desglose autoritativo fresco: { ticketsSubtotal, serviceFee, total }.
    SERVICE_FEE_CHANGED: {
        httpStatus: 409,
        logMessage: "The buyer-confirmed price breakdown from the summary screen no longer matches the authoritative server-side calculation — ticket price and/or service fee tiers changed between summary and checkout. Aborted before creating any Sale, stock reservation, or Mercado Pago preference.",
        userMessage: "El precio cambió desde que revisaste el resumen. Confirmá el nuevo total para continuar.",
    },
    // Alertas Developer — sólo puede pasar si la fila singleton fue borrada
    // a mano (nunca en uso normal: la migración la siembra). El panel
    // Developer necesita saberlo explícito para poder recrearla desde ahí;
    // el resto del sistema nunca ve esto — usa
    // getDeveloperAlertConfigOrDefaults, que no lanza (ver
    // developerAlertConfig.service.js).
    DEVELOPER_ALERT_CONFIG_MISSING: {
        httpStatus: 500,
        logMessage: "No DeveloperAlertConfig row exists — the singleton row was likely deleted manually (the migration seeds it).",
        userMessage: "No pudimos cargar la configuración de alertas.",
    },
    DEVELOPER_ALERT_CONFIG_INVALID: {
        httpStatus: 400,
        logMessage: "The proposed developer alert threshold configuration failed validation (non-positive threshold/window, or negative cooldown).",
        userMessage: "La configuración de alertas tiene errores. Revisá los valores e intentá de nuevo.",
    },

    ORGANIZER_NOTIFICATION_SETTINGS_NO_ORGANIZATION: {
        httpStatus: 409,
        logMessage: "Organizer notification settings requested/updated by a user with no organization of their own.",
        userMessage: "No encontramos una organización asociada a tu cuenta.",
    },
    ORGANIZER_NOTIFICATION_SETTINGS_INVALID: {
        httpStatus: 400,
        logMessage: "The proposed organizer notification settings failed validation (non-boolean flag, or non-positive/out-of-range numeric field).",
        userMessage: "La configuración de notificaciones tiene errores. Revisá los valores e intentá de nuevo.",
    },
});
