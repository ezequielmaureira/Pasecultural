import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getWhatsappLinkStatusService, linkWhatsappOrganizerService } from "../services/whatsappOrganizerLink.service.js";
import { buildWhatsappEventCreationLink } from "../services/whatsapp.service.js";

// Fase 2F — panel Organizer. La identidad SIEMPRE sale de la sesión Clerk
// autenticada (getAuth(req).userId), nunca del body: el POST sólo acepta
// {code}, ver whatsappOrganizerLink.service.js#linkWhatsappOrganizerService,
// que ignora cualquier otro campo que el cliente mande.
//
// El "cambio de número de WhatsApp autorizado" por OTP-vía-WhatsApp que
// vivía en este archivo (whatsappNumberChange.service.js,
// WhatsappNumberChangeChallenge) fue RETIRADO — ver el informe de entrega
// "unificación WhatsApp": el número autorizado del chatbot ahora se
// sincroniza automáticamente con el teléfono verificado de Organization
// (organizationPhoneVerification.service.js#syncWhatsappOrganizerLinkAfterVerification),
// nunca por un segundo flujo manual.
export const getWhatsappLinkStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const status = await getWhatsappLinkStatusService(userId);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const linkWhatsappOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await linkWhatsappOrganizerService(userId, req.body?.code);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Botón flotante global "Cargá tu evento con WhatsApp" del panel Organizer
// (ver OrganizerWhatsAppShortcutButton.jsx). Sólo arma la URL — nunca
// decide FREE/PREMIUM (eso lo sigue resolviendo el bot en cada mensaje
// entrante, ver blockIfWhatsappEventCreationUnavailable en
// whatsapp.controller.js): un FREE que igual golpea este endpoint recibe la
// misma URL que un PREMIUM, y si la usa, el bot lo va a frenar igual con
// WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT. requireRole("ORGANIZER")
// (ver organization.routes.js) ya alcanza acá — no hace falta resolver la
// Organization del caller, el número oficial no depende de quién pregunta.
export const getWhatsappEventCreationLink = async (req, res, next) => {
    try {
        const url = buildWhatsappEventCreationLink();
        res.status(200).json({ url });
    } catch (error) {
        next(AppError.from(error, ErrorCodes.WHATSAPP_EVENT_CREATION_LINK_UNAVAILABLE));
    }
};
