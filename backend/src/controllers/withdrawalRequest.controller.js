import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { logger } from "../logging/logger.js";
import {
    requestWithdrawalRequestOtpService,
    resendWithdrawalRequestOtpService,
    verifyWithdrawalRequestOtpService,
} from "../services/withdrawalRequestVerification.service.js";
import {
    createWithdrawalRequestService,
    listWithdrawalRequestsService,
    updateWithdrawalRequestStatusService,
} from "../services/withdrawalRequest.service.js";

// Botón de arrepentimiento — público, sin sesión. Sólo validan req y
// llaman al service; toda la lógica de negocio/seguridad vive en
// withdrawalRequestVerification.service.js / withdrawalRequest.service.js,
// mismo criterio que sale.controller.js.

export const requestWithdrawalOtp = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await requestWithdrawalRequestOtpService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendWithdrawalOtp = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await resendWithdrawalRequestOtpService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const verifyWithdrawalOtp = async (req, res, next) => {
    try {
        const { email, buyerDocument, code } = req.body;
        const result = await verifyWithdrawalRequestOtpService({ email, buyerDocument, code });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Autorizado únicamente por conocer el token en la URL (publicRecoveryToken
// de la Sale) — nunca por sesión, mismo modelo que confirm-by-buyer.
export const createWithdrawalRequest = async (req, res, next) => {
    try {
        const { reason, reasonNote } = req.body;
        const result = await createWithdrawalRequestService(req.params.token, { reason, reasonNote });
        res.status(201).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Panel Organizer/Developer > Solicitudes. requireRole ya filtró el rol
// grueso (ver withdrawalRequest.routes.js); el aislamiento fino por
// organización vive en listWithdrawalRequestsService.
export const listWithdrawalRequests = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const requests = await listWithdrawalRequestsService(userId);
        res.status(200).json({ requests });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const updateWithdrawalRequestStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        logger.info("updateWithdrawalRequestStatus controller entered", { withdrawalRequestId: req.params.id, status: req.body?.status });
        const result = await updateWithdrawalRequestStatusService(userId, req.params.id, req.body?.status);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
