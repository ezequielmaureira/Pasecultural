import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { handleMercadoPagoOAuthCallbackService } from "../services/mercadoPagoConnection.service.js";
import { logger } from "../logging/logger.js";

// MP-1 — GET /api/mercadopago/oauth/callback. PÚBLICO a propósito: Mercado
// Pago redirige acá el navegador del organizador sin ninguna sesión de
// Clerk (mismo criterio que el webhook de WhatsApp, whatsapp.controller.js
// — un tercero externo redirige/llama sin poder mandar nuestro Bearer
// token). La única prueba de identidad/autorización es el `state` de un
// solo uso (ver mercadoPagoConnection.service.js).
//
// SIEMPRE redirige de vuelta al frontend (éxito o error) — nunca deja al
// organizador varado en una respuesta JSON cruda, y NUNCA incluye tokens,
// secretos ni ningún dato de Mercado Pago en la URL de redirección: sólo
// `mercadopago=success` o `mercadopago=error&reason=<CÓDIGO_DE_ERROR>`
// (un código técnico estable de ErrorCatalog, nunca un mensaje libre que
// pudiera filtrar detalles internos).
function buildFrontendRedirectUrl(params) {
    const base = process.env.FRONTEND_URL?.trim()?.replace(/\/+$/, "");
    if (!base) {
        throw new Error("Falta configurar la variable de entorno FRONTEND_URL.");
    }
    const url = new URL(`${base}/organizador/configuracion`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    return url.toString();
}

export const handleMercadoPagoOAuthCallback = async (req, res) => {
    try {
        const result = await handleMercadoPagoOAuthCallbackService({
            code: req.query?.code,
            state: req.query?.state,
        });
        res.redirect(302, buildFrontendRedirectUrl({ mercadopago: "success", organizationId: result.organizationId }));
    } catch (error) {
        const appError = AppError.from(error, ErrorCodes.INTERNAL_ERROR);
        // Mismo criterio que errorHandler.js: se loguea el error real acá
        // (nunca tokens/secretos, ver mercadoPagoConnection.service.js, que
        // ya se cuida de no loguearlos), pero la URL de redirección sólo
        // lleva el código estable, nunca el mensaje/stack.
        logger.error(appError, { context: "mercadopago oauth callback" });
        res.redirect(302, buildFrontendRedirectUrl({ mercadopago: "error", reason: appError.code }));
    }
};
