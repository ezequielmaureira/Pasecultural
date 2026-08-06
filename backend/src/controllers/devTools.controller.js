import { AppError } from "../errors/AppError.js";
import {
    getDevDatabaseStatsService,
    resetDevDatabaseService,
    createDemoEventService,
} from "../services/devTools.service.js";

export const getDevDatabaseStats = async (req, res, next) => {
    try {
        const stats = await getDevDatabaseStatsService();
        res.status(200).json({ stats });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resetDevDatabase = async (req, res, next) => {
    try {
        const counts = await resetDevDatabaseService({ confirm: req.body?.confirm });
        res.status(200).json({ deleted: counts });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const createDemoEvent = async (req, res, next) => {
    try {
        const event = await createDemoEventService();
        res.status(201).json({ event });
    } catch (error) {
        next(AppError.from(error));
    }
};
