import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    listScannerEventsService,
    getFunctionStatsService,
    listScanAttemptsService,
} from "../services/scannerRead.service.js";

export const listScannerEvents = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const events = await listScannerEventsService(userId);
        res.status(200).json({ events });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getFunctionStats = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const stats = await getFunctionStatsService(userId, req.params.eventId, req.params.functionId);
        res.status(200).json({ stats });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listScanAttempts = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { eventId, functionId, limit } = req.query;
        const attempts = await listScanAttemptsService(userId, eventId, functionId, limit);
        res.status(200).json({ attempts });
    } catch (error) {
        next(AppError.from(error));
    }
};
