import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getOrganizerEventFunctionStatsService } from "../services/functionCapacity.service.js";

// Sólo valida req, llama al service y devuelve la respuesta — misma
// convención que el resto de los controllers. Toda la lógica de capacidad
// vive en functionCapacity.service.js (getEventFunctionStats/
// effectiveCapacity), reutilizada tal cual desde acá.
export const getEventFunctionStats = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const functions = await getOrganizerEventFunctionStatsService(userId, req.params.id);
        res.status(200).json({ functions });
    } catch (error) {
        next(AppError.from(error));
    }
};
