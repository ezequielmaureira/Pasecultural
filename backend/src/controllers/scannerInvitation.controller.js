import { AppError } from "../errors/AppError.js";
import {
    getScannerInvitationService,
    registerScannerInvitationService,
    resendScannerVerificationCodeService,
    verifyScannerInvitationCodeService,
} from "../services/scannerInvitation.service.js";

// Todo público, sin sesión: este flujo no pasa por Clerk — se registra con
// nombre/apellido/DNI/email/teléfono y se verifica con un código de 6
// dígitos mandado por email. Sólo cuando la persona ya activa quiere
// escanear de verdad inicia sesión con Clerk, en otra pantalla.

export const getScannerInvitation = async (req, res, next) => {
    try {
        const invitation = await getScannerInvitationService(req.params.token);
        res.status(200).json({ invitation });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const registerScannerInvitation = async (req, res, next) => {
    try {
        const result = await registerScannerInvitationService(req.params.token, req.body ?? {});
        res.status(200).json({ result });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendScannerVerificationCode = async (req, res, next) => {
    try {
        const result = await resendScannerVerificationCodeService(req.params.token);
        res.status(200).json({ result });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const verifyScannerInvitationCode = async (req, res, next) => {
    try {
        const invitation = await verifyScannerInvitationCodeService(req.params.token, req.body?.code, {
            userAgent: req.get("user-agent") || null,
        });
        res.status(200).json({ invitation });
    } catch (error) {
        next(AppError.from(error));
    }
};
