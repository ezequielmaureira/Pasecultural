import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getArchivedEventSummaryService } from "../services/archivedEventSummary.service.js";

// GET /api/events/archived/:eventId/summary — exclusivamente ORGANIZER
// dueño del evento, exclusivamente eventos YA archivados (ver
// archivedEventSummary.service.js). Misma convención que
// functionCapacity.controller.js: sólo valida req, llama al service,
// devuelve la respuesta.
export const getArchivedEventSummary = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const summary = await getArchivedEventSummaryService(userId, req.params.eventId);
        res.status(200).json(summary);
    } catch (error) {
        next(AppError.from(error));
    }
};
