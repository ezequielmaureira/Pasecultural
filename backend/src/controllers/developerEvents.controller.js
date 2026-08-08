import { AppError } from "../errors/AppError.js";
import {
    listDeveloperEventsService,
    getDeveloperOrganizationOptionsService,
} from "../services/developerEvents.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta — misma
// convención que el resto de los controllers. Platform-wide a propósito:
// ningún `clerkId`/organización que resolver acá (a diferencia de todo lo
// de ORGANIZER), requireRole("DEVELOPER") ya alcanza.
export const listDeveloperEvents = async (req, res, next) => {
    try {
        const { page, limit, search, organizationId, status, visibility, archived } = req.query;
        const result = await listDeveloperEventsService({
            page,
            limit,
            search,
            organizationId,
            status,
            visibility,
            archived,
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getDeveloperOrganizationOptions = async (req, res, next) => {
    try {
        const organizations = await getDeveloperOrganizationOptionsService();
        res.status(200).json({ organizations });
    } catch (error) {
        next(AppError.from(error));
    }
};
