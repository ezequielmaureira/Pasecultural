import { AppError } from "../errors/AppError.js";
import {
    listDeveloperTicketsService,
    getDeveloperTicketService,
    getDeveloperEventOptionsService,
} from "../services/developerTickets.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta — misma
// convención que developerEvents.controller.js. Platform-wide a propósito:
// ningún clerkId/organización que resolver acá, requireRole("DEVELOPER") ya
// alcanza (ver developerTickets.routes.js).
export const listDeveloperTickets = async (req, res, next) => {
    try {
        const { page, limit, search, organizationId, eventId, status, origin, deleted } = req.query;
        const result = await listDeveloperTicketsService({
            page,
            limit,
            search,
            organizationId,
            eventId,
            status,
            origin,
            deleted,
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getDeveloperTicket = async (req, res, next) => {
    try {
        const ticket = await getDeveloperTicketService(req.params.id);
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getDeveloperEventOptions = async (req, res, next) => {
    try {
        const events = await getDeveloperEventOptionsService(req.query.organizationId);
        res.status(200).json({ events });
    } catch (error) {
        next(AppError.from(error));
    }
};
