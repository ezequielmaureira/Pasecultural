import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    listActiveEventsForScannerService,
    listEventScannersService,
    createScannerInvitationsService,
    updateScannerService,
    disableScannerService,
    reactivateScannerService,
    deleteScannerService,
    revokeScannerInvitationService,
    regenerateScannerInvitationService,
    approveScannerService,
    rejectScannerService,
} from "../services/eventScanner.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta. Toda la
// validación de negocio vive en eventScanner.service.js.

export const listActiveEventsForScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const events = await listActiveEventsForScannerService(userId);
        res.status(200).json({ events });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listEventScanners = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanners = await listEventScannersService(userId, req.params.id);
        res.status(200).json({ scanners });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const createScannerInvitations = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanners = await createScannerInvitationsService(userId, req.params.id, req.body ?? {});
        res.status(201).json({ scanners });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const updateScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await updateScannerService(userId, req.params.id, req.params.scannerId, req.body ?? {});
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const disableScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await disableScannerService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const reactivateScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await reactivateScannerService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const deleteScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        await deleteScannerService(userId, req.params.id, req.params.scannerId);
        res.status(204).send();
    } catch (error) {
        next(AppError.from(error));
    }
};

export const revokeScannerInvitation = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await revokeScannerInvitationService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const regenerateScannerInvitation = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await regenerateScannerInvitationService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const approveScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await approveScannerService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const rejectScanner = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const scanner = await rejectScannerService(userId, req.params.id, req.params.scannerId);
        res.status(200).json({ scanner });
    } catch (error) {
        next(AppError.from(error));
    }
};
