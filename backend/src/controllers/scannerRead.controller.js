import { AppError } from "../errors/AppError.js";
import {
    listScannerEventsService,
    getFunctionStatsService,
    listScanAttemptsService,
    getScannerDashboardService,
} from "../services/scannerRead.service.js";

// req.scanner ya viene resuelto y verificado ACTIVE por requireScannerSession.

export const getScannerDashboard = async (req, res, next) => {
    try {
        const dashboard = await getScannerDashboardService(req.scanner);
        res.status(200).json({ dashboard });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listScannerEvents = async (req, res, next) => {
    try {
        const events = await listScannerEventsService(req.scanner);
        // name/gate salen directo de req.scanner (ya resuelto por
        // requireScannerSession, sin query extra) — es lo que la pantalla de
        // escaneo necesita mostrar como "puesto del scanner".
        res.status(200).json({ events, scanner: { name: req.scanner.name, gate: req.scanner.gate } });
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
