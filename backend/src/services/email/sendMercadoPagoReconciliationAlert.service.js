import { getResendClient, getEmailConfig, getReconciliationAlertEmail } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildMercadoPagoReconciliationAlertEmail } from "./mercadoPagoReconciliationAlertTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de services/email: nunca bloquear la respuesta HTTP indefinidamente por Resend

// Alerta interna de "Mercado Pago aprobó un pago que PaseCultural no pudo
// cumplir por falta de stock" (ver mercadoPagoWebhook.service.js, catch de
// INSUFFICIENT_STOCK). A diferencia del resto de services/email/, este
// envío es best-effort y NUNCA lanza: un fallo acá (env var del
// destinatario faltante, Resend caído, timeout) no puede hacer fallar el
// webhook ni la respuesta 200 a Mercado Pago — el caller sólo necesita
// saber si se pudo mandar o no, para loguearlo (ver auditoría, sección
// "Alerta interna por email").
export async function sendMercadoPagoReconciliationAlert({ saleId, paymentId, eventId }) {
    try {
        const to = getReconciliationAlertEmail();
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = buildMercadoPagoReconciliationAlertEmail({ saleId, paymentId, eventId });

        const resend = getResendClient();
        // Fijo por (sale, payment): si el mismo webhook se reprocesa en una
        // ráfaga corta con el mismo resultado, Resend deduplica el envío en
        // vez de mandar la misma alerta dos veces casi simultáneas. No es
        // una protección contra reintentos separados en el tiempo — a
        // propósito no se agrega deduplicación propia acá (ver auditoría,
        // sección "Alertas duplicadas"): que la alerta pueda repetirse si
        // Mercado Pago reenvía el webhook más tarde es un comportamiento
        // aceptado, no un bug.
        const idempotencyKey = `mp-reconciliation-alert/${saleId}/${paymentId}`;
        const result = await withTimeout(
            resend.emails.send({ from, to, replyTo, subject, html, text }, { idempotencyKey }),
            RESEND_CALL_TIMEOUT_MS,
            "resend_timeout"
        );

        if (result.error) {
            logger.error("sendMercadoPagoReconciliationAlert: Resend devolvió un error", {
                saleId,
                paymentId,
                errorName: result.error.name,
            });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendMercadoPagoReconciliationAlert: enviada", { saleId, paymentId, providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendMercadoPagoReconciliationAlert: intento fallido", {
            saleId,
            paymentId,
            errorName: err?.name || "Error",
            errorMessage: err?.message,
        });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}
