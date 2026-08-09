import { AppError } from "../errors/AppError.js";
import { listDeveloperScannersService, getDeveloperScannerService } from "../services/developerScanners.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta — misma
// convención que developerTickets.controller.js/developerEvents.controller.js.
// Platform-wide a propósito: ningún clerkId/organización que resolver acá,
// requireRole("DEVELOPER") ya alcanza (ver developerScanners.routes.js).
export const listDeveloperScanners = async (req, res, next) => {
    try {
        const { page, limit, search, organizationId, eventId, status } = req.query;
        const result = await listDeveloperScannersService({ page, limit, search, organizationId, eventId, status });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getDeveloperScanner = async (req, res, next) => {
    try {
        const scanner = await getDeveloperScannerService(req.params.id);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};
