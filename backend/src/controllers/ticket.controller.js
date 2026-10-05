import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { listTicketsOrganizerService } from "../services/ticket.service.js";

// Panel de organizador "Entradas" — todos los tickets vendidos de todos sus
// eventos, con búsqueda y filtro de estado (ver listTicketsOrganizerService).
export const listTicketsOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { search, status, eventId, functionId } = req.query;
        const tickets = await listTicketsOrganizerService(userId, { search, status, eventId, functionId });
        res.status(200).json({ tickets });
    } catch (error) {
        next(AppError.from(error));
    }
};
