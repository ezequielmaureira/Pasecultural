import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getWhatsappLinkStatusService, linkWhatsappOrganizerService } from "../services/whatsappOrganizerLink.service.js";

// Fase 2F — panel Organizer. La identidad SIEMPRE sale de la sesión Clerk
// autenticada (getAuth(req).userId), nunca del body: el POST sólo acepta
// {code}, ver whatsappOrganizerLink.service.js#linkWhatsappOrganizerService,
// que ignora cualquier otro campo que el cliente mande.
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
