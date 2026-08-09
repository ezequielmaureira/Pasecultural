import { AppError } from "../errors/AppError.js";
import {
    getDevDatabaseStatsService,
    resetDevDatabaseService,
    createDemoEventService,
    testSendWhatsappService,
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

// POST /api/dev/whatsapp/test-send — Fase 2C, envío manual de un único
// mensaje de prueba. Nunca se loguea el body de la request (teléfono/texto)
// acá; testSendWhatsappService ya se encarga de no loguear nada sensible
// del lado del service tampoco.
export const testSendWhatsapp = async (req, res, next) => {
    try {
        const { to, text } = req.body ?? {};
        const result = await testSendWhatsappService({ to, text });
        res.status(200).json({ success: true, messageId: result.messageId });
    } catch (error) {
        next(AppError.from(error));
    }
};
