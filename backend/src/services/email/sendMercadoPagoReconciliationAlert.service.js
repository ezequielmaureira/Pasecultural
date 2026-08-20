import { getResendClient, getEmailConfig, getReconciliationAlertEmail } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import {
    buildMercadoPagoReconciliationAlertEmail,
    buildMercadoPagoReversalAlertEmail,
    buildMercadoPagoCredentialUnresolvableAlertEmail,
} from "./mercadoPagoReconciliationAlertTemplate.js";
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

// Alerta interna de reversión financiera (refund/chargeback) — ver
// mercadoPagoWebhook.service.js, bloque REVERSAL_STATUSES. Reusa
// exactamente la misma infraestructura que sendMercadoPagoReconciliationAlert
// (mismo cliente Resend, misma config de remitente, mismo destinatario vía
// MERCADOPAGO_RECONCILIATION_ALERT_EMAIL) — no se agrega una env var nueva
// para esto. Igual de best-effort: nunca lanza, un fallo acá no puede
// afectar la respuesta del webhook.
//
// `type`: "REFUNDED" | "CHARGED_BACK". `ticketsAffected`: la cantidad de
// tickets ACTIVE→REFUNDED que acaba de invalidar ESTA ejecución (puede ser
// 0 si la reversión ya se había procesado antes, o si la Sale nunca llegó
// a confirmarse) — se pasa tal cual, sin reinterpretar.
export async function sendMercadoPagoReversalAlert({ type, saleId, paymentId, eventId, organizationId, ticketsAffected }) {
    try {
        const to = getReconciliationAlertEmail();
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = buildMercadoPagoReversalAlertEmail({
            type,
            saleId,
            paymentId,
            eventId,
            organizationId,
            ticketsAffected,
        });

        const resend = getResendClient();
        // A propósito SIN idempotencyKey — a diferencia de
        // sendMercadoPagoReconciliationAlert, acá se quiere exactamente lo
        // contrario: un webhook de refunded/charged_back reenviado por
        // Mercado Pago debe poder volver a disparar esta alerta. No se
        // implementa ninguna deduplicación en esta fase (decisión explícita).
        const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

        if (result.error) {
            logger.error("sendMercadoPagoReversalAlert: Resend devolvió un error", {
                type,
                saleId,
                paymentId,
                errorName: result.error.name,
            });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendMercadoPagoReversalAlert: enviada", { type, saleId, paymentId, providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendMercadoPagoReversalAlert: intento fallido", {
            type,
            saleId,
            paymentId,
            errorName: err?.name || "Error",
            errorMessage: err?.message,
        });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}

// Alerta interna de "no pudimos verificar autoritativamente este payment
// porque la credencial histórica de Mercado Pago ya no es utilizable" —
// ver mercadoPagoWebhook.service.js (auditoría de reversión tardía con
// conexión OAuth muerta). Misma infraestructura reusada que las dos
// funciones de arriba (mismo cliente Resend, mismo remitente, mismo
// MERCADOPAGO_RECONCILIATION_ALERT_EMAIL) — sin env var nueva. Best-effort:
// nunca lanza.
//
// A diferencia de sendMercadoPagoReversalAlert, ACÁ SÍ se usa un
// idempotencyKey fijo por (sale, payment): mientras la credencial siga
// muerta, Mercado Pago va a seguir reintentando este mismo webhook cada
// ~15 minutos (según su política documentada) — sin esto, cada reintento
// mandaría un email nuevo indefinidamente mientras nadie resuelva la
// causa. Resend deduplica dentro de su ventana de idempotencia; no es una
// garantía de "una sola alerta para siempre", pero evita el spam
// sostenido de un incidente que puede tardar en resolverse.
export async function sendMercadoPagoCredentialUnresolvableAlert({
    saleId,
    paymentId,
    eventId,
    organizationId,
    connectionId,
    connectionStatus,
    reason,
}) {
    try {
        const to = getReconciliationAlertEmail();
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = buildMercadoPagoCredentialUnresolvableAlertEmail({
            saleId,
            paymentId,
            eventId,
            organizationId,
            connectionId,
            connectionStatus,
            reason,
        });

        const resend = getResendClient();
        const idempotencyKey = `mp-credential-unresolvable-alert/${saleId}/${paymentId}`;
        const result = await withTimeout(
            resend.emails.send({ from, to, replyTo, subject, html, text }, { idempotencyKey }),
            RESEND_CALL_TIMEOUT_MS,
            "resend_timeout"
        );

        if (result.error) {
            logger.error("sendMercadoPagoCredentialUnresolvableAlert: Resend devolvió un error", {
                saleId,
                paymentId,
                errorName: result.error.name,
            });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendMercadoPagoCredentialUnresolvableAlert: enviada", { saleId, paymentId, providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendMercadoPagoCredentialUnresolvableAlert: intento fallido", {
            saleId,
            paymentId,
            errorName: err?.name || "Error",
            errorMessage: err?.message,
        });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}
