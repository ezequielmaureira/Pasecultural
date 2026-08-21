import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    getOrganizerNotificationSettingsService,
    replaceOrganizerNotificationSettingsService,
} from "../services/organizerNotificationSettings.service.js";

// Dashboard Organizador > Configuración > Notificaciones. requireRole ya
// filtró el rol grueso (ver organizerNotificationSettings.routes.js); el
// aislamiento fino por organización vive en el service
// (getMyOrganizationService por clerkId autenticado, nunca un
// organizationId que mande el cliente).
export const getOrganizerNotificationSettings = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const settings = await getOrganizerNotificationSettingsService(userId);
        res.status(200).json(settings);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const updateOrganizerNotificationSettings = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const settings = await replaceOrganizerNotificationSettingsService(userId, req.body);
        res.status(200).json(settings);
    } catch (error) {
        next(AppError.from(error));
    }
};
