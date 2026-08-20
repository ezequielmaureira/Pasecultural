import { AppError } from "../errors/AppError.js";
import { logger } from "../logging/logger.js";
import {
    getMercadoPagoWebhookSecret,
    verifyMercadoPagoWebhookSignature,
    parseXSignatureHeader,
} from "../config/mercadoPagoWebhookSignature.js";
import { processMercadoPagoWebhookNotification } from "../services/mercadoPagoWebhook.service.js";

// Auditoría "endurecer webhook" — Mercado Pago soporta dos formatos de
// notificación históricamente: el moderno Webhooks v2 (query `data.id` +
// `type`, header `x-signature`) que este controller procesa, y el IPN
// legado (query `topic`+`id`, SIN x-signature — se vio en tráfico real
// con User-Agent "MercadoPago Feed v2.0 ..."). PaseCultural NUNCA
// implementó IPN legado — se detecta acá EXCLUSIVAMENTE para poder
// reconocerlo y descartarlo de forma explícita (ver más abajo), nunca
// para procesarlo: "webhook_v2" gana siempre que aparezca cualquier
// indicio moderno, aunque también vengan `topic`/`id` de sobra.
function detectMercadoPagoNotificationFormat(req) {
    const hasModernIndicator = Boolean(req.query?.["data.id"]) || Boolean(req.body?.data?.id) || Boolean(req.query?.type) || Boolean(req.body?.type);
    if (hasModernIndicator) return "webhook_v2";
    if (typeof req.query?.topic === "string" && typeof req.query?.id === "string") return "ipn_legacy";
    return "unknown";
}

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
//         pago todavía no aprobado, no se pudo correlacionar, etc.), o
//         un formato IPN legado deliberadamente no soportado —
//         reintentarla no cambiaría nada, así que nunca hace falta que
//         Mercado Pago la reintente.
//   401 — firma ausente, inválida, o data.id de query/body inconsistentes
//         (SOLO para tráfico que se identifica como Webhooks v2 — el IPN
//         legado nunca llega a este chequeo, ver más abajo).
//   429 — límite de tasa defensivo (ver mercadoPago.routes.js) — nunca es
//         la protección real, sólo reduce ruido/CPU; Mercado Pago lo
//         reintenta como cualquier respuesta no-200/201.
//   500 — error transitorio propio (Mercado Pago caído/timeout, error de
//         red, falta de configuración de MERCADOPAGO_WEBHOOK_SECRET, o
//         cualquier excepción no prevista) — ahí sí vale la pena que
//         Mercado Pago reintente más tarde.
export const handleMercadoPagoWebhook = async (req, res) => {
    const xRequestId = req.headers["x-request-id"] ?? null;
    const dataIdFromQuery = req.query?.["data.id"] ?? null;
    const bodyDataId = req.body?.data?.id ?? null;
    const type = req.body?.type ?? req.query?.type ?? null;
    const action = req.body?.action ?? req.query?.action ?? null;
    const format = detectMercadoPagoNotificationFormat(req);

    // Punto único de entrada — un solo log estructurado ANTES de cualquier
    // validación/decisión, para poder correlacionar "recibido ->
    // validación -> procesamiento -> resultado" con un mismo x-request-id
    // sin tener que reconstruirlo a partir de logs dispersos. Sólo
    // metadata no sensible: nunca x-signature completa, nunca el secret,
    // nunca tokens, nunca el body completo, nunca datos personales.
    logger.info("mercadopago webhook: recibido", {
        xRequestId,
        type,
        action,
        dataIdFromQuery,
        dataIdFromBody: bodyDataId,
        queryKeys: Object.keys(req.query ?? {}),
        userAgent: req.headers["user-agent"] ?? null,
        contentType: req.headers["content-type"] ?? null,
        format,
    });

    try {
        // IPN legado — se descarta ACÁ, ANTES de cualquier validación de
        // firma o procesamiento financiero: nunca se usa topic/id de este
        // formato para nada (nunca correlaciona una Sale, nunca confirma,
        // nunca invalida), y nunca abre camino hacia
        // processMercadoPagoWebhookNotification. 200 (no 401) a propósito:
        // no es un intento de firma inválida ni un ataque — es un formato
        // que deliberadamente no procesamos (mismo criterio que "topic
        // ignorado" en mercadoPagoWebhook.service.js) — reintentarlo no
        // cambiaría nada, así que reintentar sería puro ruido para ambos
        // lados.
        if (format === "ipn_legacy") {
            logger.info("mercadopago webhook: formato IPN legado detectado — no soportado, se descarta sin procesar", {
                xRequestId,
                topic: typeof req.query?.topic === "string" ? req.query.topic : null,
                legacyId: typeof req.query?.id === "string" ? req.query.id : null,
                userAgent: req.headers["user-agent"] ?? null,
            });
            return res.status(200).json({ received: true, action: "ignored_legacy_ipn" });
        }

        const xSignature = req.headers["x-signature"];

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
            // Diagnóstico MP-3 (auditoría de ráfagas de firma inválida) — sólo
            // metadata no sensible, para poder correlacionar de dónde vienen
            // estas requests sin exponer x-signature/v1/ts/secret. No influye
            // en absoluto en el resultado de la validación de arriba.
            logger.warn("mercadopago webhook: firma inválida", {
                type,
                action,
                dataIdFromQuery,
                dataIdFromBody: bodyDataId,
                queryKeys: Object.keys(req.query ?? {}),
                xRequestId,
                userAgent: req.headers["user-agent"] ?? null,
                contentType: req.headers["content-type"] ?? null,
                hasSignature: Boolean(xSignature),
                signatureFormatValid: parseXSignatureHeader(xSignature) !== null,
            });
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

        const dataId = dataIdFromQuery ?? bodyDataId;
        const bodyUserId = req.body?.user_id;

        const outcome = await processMercadoPagoWebhookNotification({ type, dataId, bodyUserId });

        if (!outcome.ok) {
            return res.status(500).json({ received: true, action: outcome.action });
        }
        return res.status(200).json({ received: true, action: outcome.action });
    } catch (error) {
        // Más contexto que antes: paymentId/x-request-id/type/formato ya
        // están resueltos arriba sin ninguna query adicional. saleId NO se
        // agrega a propósito — en este punto del controller no hay forma
        // de conocerlo sin acoplarse al resultado interno de
        // processMercadoPagoWebhookNotification (que puede no haber
        // llegado a resolver ninguna Sale), así que se deja afuera en vez
        // de inventarlo.
        const appError = AppError.from(error);
        logger.error(appError, {
            context: "mercadopago webhook controller",
            xRequestId,
            type,
            format,
            paymentId: dataIdFromQuery ?? bodyDataId ?? null,
        });
        return res.status(500).json({ received: true, action: "internal_error" });
    }
};
