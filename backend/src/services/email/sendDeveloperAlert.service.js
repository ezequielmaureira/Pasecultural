import prisma from "../../config/prisma.js";
import { getResendClient, getEmailConfig, getDeveloperAlertEmail } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { withTimeout } from "../../utils/withTimeout.js";
import {
    buildNewOrganizationPendingEmail,
    buildMercadoPagoFirstConnectionEmail,
    buildMercadoPagoDisconnectedEmail,
    buildFirstConfirmedSaleEmail,
    buildFinancialInvariantBrokenEmail,
    buildHighTicketPriceEmail,
    buildHighQuantitySaleEmail,
    buildTooManyEventsEmail,
    buildSalesVolumeSpikeEmail,
    buildRefundsVolumeSpikeEmail,
} from "./developerAlertTemplates.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que sendMercadoPagoReconciliationAlert.service.js

// Radar Developer (riesgo de plataforma, comportamiento excepcional,
// integraciones, anomalías financieras) — DISTINTO del radar de
// conciliación financiera de Mercado Pago (sendMercadoPagoReconciliationAlert.service.js,
// MERCADOPAGO_RECONCILIATION_ALERT_EMAIL). Responsabilidades separadas a
// propósito (ver informe de entrega): DEVELOPER_ALERT_EMAIL es su propia
// variable de entorno, lazy, nunca mezclada con la de conciliación.
export const DeveloperAlertType = Object.freeze({
    NEW_ORGANIZATION_PENDING: "NEW_ORGANIZATION_PENDING",
    MERCADOPAGO_FIRST_CONNECTION: "MERCADOPAGO_FIRST_CONNECTION",
    MERCADOPAGO_DISCONNECTED: "MERCADOPAGO_DISCONNECTED",
    FIRST_CONFIRMED_SALE: "FIRST_CONFIRMED_SALE",
    FINANCIAL_INVARIANT_BROKEN: "FINANCIAL_INVARIANT_BROKEN",
    HIGH_TICKET_PRICE: "HIGH_TICKET_PRICE",
    HIGH_QUANTITY_SALE: "HIGH_QUANTITY_SALE",
    TOO_MANY_EVENTS: "TOO_MANY_EVENTS",
    SALES_VOLUME_SPIKE: "SALES_VOLUME_SPIKE",
    REFUNDS_VOLUME_SPIKE: "REFUNDS_VOLUME_SPIKE",
});

const TEMPLATE_BUILDERS = {
    [DeveloperAlertType.NEW_ORGANIZATION_PENDING]: buildNewOrganizationPendingEmail,
    [DeveloperAlertType.MERCADOPAGO_FIRST_CONNECTION]: buildMercadoPagoFirstConnectionEmail,
    [DeveloperAlertType.MERCADOPAGO_DISCONNECTED]: buildMercadoPagoDisconnectedEmail,
    [DeveloperAlertType.FIRST_CONFIRMED_SALE]: buildFirstConfirmedSaleEmail,
    [DeveloperAlertType.FINANCIAL_INVARIANT_BROKEN]: buildFinancialInvariantBrokenEmail,
    [DeveloperAlertType.HIGH_TICKET_PRICE]: buildHighTicketPriceEmail,
    [DeveloperAlertType.HIGH_QUANTITY_SALE]: buildHighQuantitySaleEmail,
    [DeveloperAlertType.TOO_MANY_EVENTS]: buildTooManyEventsEmail,
    [DeveloperAlertType.SALES_VOLUME_SPIKE]: buildSalesVolumeSpikeEmail,
    [DeveloperAlertType.REFUNDS_VOLUME_SPIKE]: buildRefundsVolumeSpikeEmail,
};

// Best-effort SIEMPRE — nunca lanza, mismo criterio que
// sendMercadoPagoReconciliationAlert.service.js. Ningún caller de este
// archivo puede dejar de completar su operación principal (crear
// organización, conectar/desconectar Mercado Pago, confirmar una venta,
// crear un evento, procesar un webhook) sólo porque esta alerta no se pudo
// mandar — ver informe de entrega, sección "Best-effort obligatorio".
export async function sendDeveloperAlert(type, payload) {
    const builder = TEMPLATE_BUILDERS[type];
    if (!builder) {
        logger.error(new Error(`sendDeveloperAlert: tipo de alerta desconocido "${type}"`), { type });
        return { sent: false, reason: "unknown_alert_type" };
    }

    // Chequeo explícito ANTES de intentar armar el email — así el log deja
    // constancia clara de "falta configuración", distinto de un error real
    // de Resend (ver informe de entrega, sección "Destinatario" — lazy: la
    // app arranca igual, ninguna operación principal falla por esto).
    if (!process.env.DEVELOPER_ALERT_EMAIL?.trim()) {
        logger.warn("sendDeveloperAlert: DEVELOPER_ALERT_EMAIL no está configurada — la alerta Developer no se pudo enviar, la operación principal continúa igual", { type });
        return { sent: false, reason: "developer_alert_email_not_configured" };
    }

    try {
        const to = getDeveloperAlertEmail();
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = builder(payload);

        const resend = getResendClient();
        const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

        if (result.error) {
            logger.error("sendDeveloperAlert: Resend devolvió un error", { type, errorName: result.error.name });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendDeveloperAlert: enviada", { type, providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendDeveloperAlert: intento fallido", { type, errorName: err?.name || "Error", errorMessage: err?.message });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}

// Deduplicación/cooldown PERSISTENTE (ver DeveloperAlertCooldown en
// schema.prisma) — nunca en memoria del proceso Node: Render puede
// reiniciar o correr más de una instancia. `key` identifica de forma
// estable qué se está limitando (ej. "SALES_VOLUME_SPIKE:{organizationId}").
//
// Atómico entre instancias concurrentes con dos pasos, sin ningún lock
// explícito (mismo espíritu que el resto del proyecto — updateMany
// condicional en vez de SELECT FOR UPDATE):
//   1) intenta CREAR la fila — si `key` nunca existió, gana y manda
//      (Postgres rechaza con P2002 a cualquier otro intento concurrente
//      de crear la MISMA key, así que sólo uno puede "ganar" acá).
//   2) si la fila ya existe, sólo puede "ganar" un UPDATE condicionado a
//      `lastFiredAt < cutoff` — Postgres serializa los UPDATE concurrentes
//      sobre la MISMA fila con un lock de fila implícito: el segundo
//      UPDATE que llega vuelve a evaluar su WHERE después de que el
//      primero commitea, ve el lastFiredAt YA actualizado (no < cutoff) y
//      no matchea ninguna fila — así que sólo uno de los dos puede
//      reclamar el cooldown, nunca los dos.
// cooldownMinutes <= 0 desactiva el cooldown (siempre manda).
export async function tryClaimDeveloperAlertCooldown(key, cooldownMinutes) {
    if (!(cooldownMinutes > 0)) return true;
    const now = new Date();

    try {
        await prisma.developerAlertCooldown.create({ data: { key, lastFiredAt: now } });
        return true;
    } catch (err) {
        if (err?.code !== "P2002") throw err;
    }

    const cutoff = new Date(now.getTime() - cooldownMinutes * 60 * 1000);
    const claimed = await prisma.developerAlertCooldown.updateMany({
        where: { key, lastFiredAt: { lt: cutoff } },
        data: { lastFiredAt: now },
    });
    return claimed.count === 1;
}
