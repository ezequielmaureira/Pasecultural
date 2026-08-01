import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    listEventScannersService,
    addEventScannerService,
    removeEventScannerService,
} from "../services/eventScanner.service.js";

export const listEventScanners = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanners = await listEventScannersService(userId, req.params.id);
        res.status(200).json({ scanners });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const addEventScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await addEventScannerService(userId, req.params.id, req.body?.email);
        res.status(201).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const removeEventScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        await removeEventScannerService(userId, req.params.id, req.params.userId);
        res.status(204).send();
    } catch (error) {
        next(AppError.from(error));
    }
};
