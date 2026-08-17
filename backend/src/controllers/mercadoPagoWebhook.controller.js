import { AppError } from "../errors/AppError.js";
import { logger } from "../logging/logger.js";
import { getMercadoPagoWebhookSecret, verifyMercadoPagoWebhookSignature } from "../config/mercadoPagoWebhookSignature.js";
import { processMercadoPagoWebhookNotification } from "../services/mercadoPagoWebhook.service.js";

// MP-3 — POST /api/mercadopago/webhook. PÚBLICO a propósito (Mercado Pago
// llama acá sin ninguna sesión de Clerk, mismo criterio que el callback
// OAuth de MP-1 y el webhook de WhatsApp) — pero público NUNCA significa
// confiar en el body: la autenticidad se valida criptográficamente vía
// x-signature ANTES de leer nada más del request (ver
// mercadoPagoWebhookSignature.js). Una firma ausente o inválida corta acá
// mismo, sin tocar la base ni llamar a Mercado Pago.
//
// Status devueltos (Mercado Pago reintenta automáticamente notificaciones
// no confirmadas con 200/201, documentado oficialmente):
//   200 — notificación procesada de forma determinista y completa, sea
//         cual sea el resultado de negocio (confirmada, ya confirmada,
//         pago todavía no aprobado, no se pudo correlacionar, etc.) —
//         reintentarla no cambiaría nada, así que nunca hace falta que
//         Mercado Pago la reintente.
//   401 — firma ausente, inválida, o data.id de query/body inconsistentes.
//   500 — error transitorio propio (Mercado Pago caído/timeout, error de
//         red, falta de configuración de MERCADOPAGO_WEBHOOK_SECRET, o
//         cualquier excepción no prevista) — ahí sí vale la pena que
//         Mercado Pago reintente más tarde.
export const handleMercadoPagoWebhook = async (req, res) => {
    try {
        const xSignature = req.headers["x-signature"];
        const xRequestId = req.headers["x-request-id"];
        const dataIdFromQuery = req.query?.["data.id"];
        const bodyDataId = req.body?.data?.id;

        if (!xSignature) {
            logger.warn("mercadopago webhook: falta el header x-signature");
            return res.status(401).json({ received: false, error: "MISSING_SIGNATURE" });
        }

        let secret;
        try {
            secret = getMercadoPagoWebhookSecret();
        } catch (error) {
            // Error de configuración del propio backend, nunca de quien
            // llama — 500 para que quede visible en logs/alertas y Mercado
            // Pago reintente una vez esté resuelto.
            logger.error(error, { context: "mercadopago webhook: falta configurar MERCADOPAGO_WEBHOOK_SECRET" });
            return res.status(500).end();
        }

        const validSignature = verifyMercadoPagoWebhookSignature({
            xSignature,
            xRequestId,
            dataId: dataIdFromQuery,
            secret,
        });
        if (!validSignature) {
            logger.warn("mercadopago webhook: firma inválida");
            return res.status(401).json({ received: false, error: "INVALID_SIGNATURE" });
        }

        // Defensivo: data.id de la query (lo único cubierto por la firma) y
        // data.id del body deben coincidir — si alguna vez no lo hicieran,
        // no hay forma segura de saber cuál de los dos usar, así que se
        // rechaza en vez de elegir uno a ciegas.
        if (dataIdFromQuery && bodyDataId && String(dataIdFromQuery) !== String(bodyDataId)) {
            logger.warn("mercadopago webhook: data.id de query y de body no coinciden");
            return res.status(401).json({ received: false, error: "DATA_ID_MISMATCH" });
        }

        const type = req.body?.type ?? req.query?.type;
        const dataId = dataIdFromQuery ?? bodyDataId;
        const bodyUserId = req.body?.user_id;

        const outcome = await processMercadoPagoWebhookNotification({ type, dataId, bodyUserId });

        if (!outcome.ok) {
            return res.status(500).json({ received: true, action: outcome.action });
        }
        return res.status(200).json({ received: true, action: outcome.action });
    } catch (error) {
        const appError = AppError.from(error);
        logger.error(appError, { context: "mercadopago webhook controller" });
        return res.status(500).json({ received: true, action: "internal_error" });
    }
};
