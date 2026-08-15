import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getWhatsappLinkStatusService, linkWhatsappOrganizerService } from "../services/whatsappOrganizerLink.service.js";
import {
    getWhatsappNumberChangeStatusService,
    requestWhatsappNumberChangeService,
    verifyWhatsappNumberChangeService,
    resendWhatsappNumberChangeOtpService,
    cancelWhatsappNumberChangeService,
} from "../services/whatsappNumberChange.service.js";

// Fase 2F — panel Organizer. La identidad SIEMPRE sale de la sesión Clerk
// autenticada (getAuth(req).userId), nunca del body: el POST sólo acepta
// {code}, ver whatsappOrganizerLink.service.js#linkWhatsappOrganizerService,
// que ignora cualquier otro campo que el cliente mande.
export const getWhatsappLinkStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const status = await getWhatsappLinkStatusService(userId);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const linkWhatsappOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await linkWhatsappOrganizerService(userId, req.body?.code);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// ==================================================================
// Cambio de número de WhatsApp autorizado — la identidad sale SIEMPRE de
// la sesión Clerk (getAuth(req).userId); organizationId sale del body en
// los POST (o query en el GET) pero NUNCA se confía en él por sí solo —
// cada service revalida pertenencia real contra la sesión autenticada
// antes de tocar nada (ver whatsappNumberChange.service.js#resolveOrganizationForOwnerOrThrow).
// ==================================================================

export const getWhatsappNumberChangeStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const status = await getWhatsappNumberChangeStatusService(userId, req.query?.organizationId);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const requestWhatsappNumberChange = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await requestWhatsappNumberChangeService(userId, req.body?.organizationId, req.body?.phone);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const verifyWhatsappNumberChange = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await verifyWhatsappNumberChangeService(userId, req.body?.organizationId, req.body?.code);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendWhatsappNumberChangeOtp = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await resendWhatsappNumberChangeOtpService(userId, req.body?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const cancelWhatsappNumberChange = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await cancelWhatsappNumberChangeService(userId, req.body?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
