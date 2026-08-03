import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getScannerInvitationService, claimScannerInvitationService } from "../services/scannerInvitation.service.js";

// Público, sin sesión: la pantalla de invitación necesita mostrar "vas a
// operar como scanner de X evento, puerta Y" ANTES de que la persona
// inicie sesión con Clerk.
export const getScannerInvitation = async (req, res, next) => {
    try {
        const invitation = await getScannerInvitationService(req.params.token);
        res.status(200).json({ invitation });
    } catch (error) {
        next(AppError.from(error));
    }
};

// Autenticado: requiere sesión de Clerk ya resuelta (el frontend redirige a
// iniciar-sesión/registro con `?redirect=` de vuelta a esta misma
// invitación si hace falta).
export const claimScannerInvitation = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await claimScannerInvitationService(userId, req.params.token, {
            userAgent: req.get("user-agent") || null,
        });
        res.status(200).json({ invitation: result });
    } catch (error) {
        next(AppError.from(error));
    }
};
