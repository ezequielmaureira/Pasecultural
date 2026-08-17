import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import { getMercadoPagoConnectionStatusService, startMercadoPagoConnectService } from "../services/mercadoPagoConnection.service.js";

// MP-1 — sub-recurso "/me/mercadopago", mismo patrón que
// organizationWhatsapp.controller.js. La identidad SIEMPRE sale de la
// sesión Clerk autenticada (getAuth(req).userId), nunca del body/query;
// organizationId SÍ viaja explícito (query/body) pero se revalida contra
// la sesión en el service — nunca se confía en él por sí solo.

export const getMercadoPagoStatus = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const status = await getMercadoPagoConnectionStatusService(userId, req.query?.organizationId);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const startMercadoPagoConnect = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await startMercadoPagoConnectService(userId, req.query?.organizationId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
