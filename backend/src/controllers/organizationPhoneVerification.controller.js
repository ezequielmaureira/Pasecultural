import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    getOrganizationPhoneStatusService,
    requestOrganizationPhoneVerificationService,
    verifyOrganizationPhoneChangeOtpService,
    resendOrganizationPhoneWhatsappService,
    resendOrganizationPhoneChangeOtpService,
    cancelOrganizationPhoneChangeService,
} from "../services/organizationPhoneVerification.service.js";

// Verificación de teléfono/WhatsApp de Organización — mismo criterio que
// organizationWhatsapp.controller.js: la identidad SIEMPRE sale de la
// sesión Clerk (getAuth(req).userId); organizationId sale del body/query
// pero NUNCA se confía en él por sí solo — cada service revalida
// pertenencia real (ver organizationPhoneVerification.service.js#resolveOrganizationForOwnerOrThrow).

export const getOrganizationPhoneStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const status = await getOrganizationPhoneStatusService(userId, req.query?.organizationId);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const requestOrganizationPhoneVerification = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await requestOrganizationPhoneVerificationService(userId, req.body?.organizationId, req.body?.phone);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const verifyOrganizationPhoneChangeOtp = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await verifyOrganizationPhoneChangeOtpService(userId, req.body?.organizationId, req.body?.code);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendOrganizationPhoneWhatsapp = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await resendOrganizationPhoneWhatsappService(userId, req.body?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendOrganizationPhoneChangeOtp = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await resendOrganizationPhoneChangeOtpService(userId, req.body?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const cancelOrganizationPhoneChange = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await cancelOrganizationPhoneChangeService(userId, req.body?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
