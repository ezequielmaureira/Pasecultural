import { AppError } from "../errors/AppError.js";
import {
    listScannerEventsService,
    getFunctionStatsService,
    listScanAttemptsService,
} from "../services/scannerRead.service.js";

// req.scanner ya viene resuelto y verificado ACTIVE por requireScannerSession.

export const listScannerEvents = async (req, res, next) => {
    try {
        const events = await listScannerEventsService(req.scanner);
        res.status(200).json({ events });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getFunctionStats = async (req, res, next) => {
    try {
        const stats = await getFunctionStatsService(req.scanner, req.params.eventId, req.params.functionId);
        res.status(200).json({ stats });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listScanAttempts = async (req, res, next) => {
    try {
        const { eventId, functionId, limit } = req.query;
        const attempts = await listScanAttemptsService(req.scanner, eventId, functionId, limit);
        res.status(200).json({ attempts });
    } catch (error) {
        next(AppError.from(error));
    }
};
