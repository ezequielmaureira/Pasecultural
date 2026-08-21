import prisma from "../config/prisma.js";
import { getResendClient, getEmailConfig, getDeveloperAlertEmail } from "../config/resend.js";
import { logger } from "../logging/logger.js";
import { withTimeout } from "../utils/withTimeout.js";
import { escapeHtml } from "../utils/htmlEscape.js";

// Alertas Developer — resumen diario. Servicio INVOCABLE, no un cron: este
// proyecto no tiene ninguna infraestructura de jobs/cron todavía (auditado
// antes de escribir esto — ver informe de entrega, sección "Resumen
// diario"), así que a propósito NO se agrega un setInterval dentro del
// servidor web (correría una vez por instancia de Render, duplicado, y
// sobreviviría reinicios de forma impredecible). Para producir el digest
// realmente todos los días hace falta un Render Cron Job apuntando a
// `node scripts/sendDeveloperDailyDigest.js` (ver ese archivo) — documentado
// en el informe de entrega, NUNCA desplegado en esta ronda.

const RESEND_CALL_TIMEOUT_MS = 10000;
const DIGEST_WINDOW_HOURS = 24;

async function collectDailyDigestStats(windowStart) {
    // Tickets emitidos en la ventana — Ticket no tiene createdAt (mismo
    // motivo que impide medir volumen de refunds sin el log dedicado, ver
    // DeveloperAlertReversalEvent), así que se cuenta vía SaleItem.quantity
    // de las Sale CONFIRMED de la ventana — exacto, porque los tickets se
    // emiten uno a uno por cada unidad comprada, en el mismo momento en
    // que la Sale se confirma (ver confirmSaleService, sale.service.js).
    const ticketsSoldItems = prisma.saleItem
        .findMany({
            where: { sale: { status: "CONFIRMED", origin: "SALE", confirmedAt: { gte: windowStart } } },
            select: { quantity: true },
        })
        .then((items) => items.reduce((sum, item) => sum + item.quantity, 0));

    const [newOrganizations, pendingOrganizations, eventsCreated, salesConfirmed, ticketsSold, refunded, chargedBack, volumeAlertsFired] = await Promise.all([
        prisma.organization.count({ where: { createdAt: { gte: windowStart } } }),
        prisma.organization.count({ where: { status: "PENDING" } }),
        prisma.event.count({ where: { createdAt: { gte: windowStart } } }),
        prisma.sale.count({ where: { status: "CONFIRMED", origin: "SALE", confirmedAt: { gte: windowStart } } }),
        ticketsSoldItems,
        prisma.developerAlertReversalEvent.count({ where: { type: "REFUNDED", occurredAt: { gte: windowStart } } }),
        prisma.developerAlertReversalEvent.count({ where: { type: "CHARGED_BACK", occurredAt: { gte: windowStart } } }),
        prisma.developerAlertCooldown.count({ where: { lastFiredAt: { gte: windowStart } } }),
    ]);

    // Primeras ventas de la ventana — organizaciones cuya Sale CONFIRMED
    // MÁS ANTIGUA (de todas las que tenga, no sólo las de esta ventana)
    // cae dentro de la ventana. Sale no tiene organizationId propio (sólo
    // vía Event), así que hace falta el join — sigue siendo de sólo
    // lectura, nunca escribe nada.
    const firstSaleRows = await prisma.$queryRaw`
        SELECT e."organizationId" AS "organizationId", MIN(s."confirmedAt") AS "firstConfirmedAt"
        FROM "sales" s
        JOIN "Event" e ON e.id = s."eventId"
        WHERE s.status = 'CONFIRMED' AND s.origin = 'SALE'
        GROUP BY e."organizationId"
        HAVING MIN(s."confirmedAt") >= ${windowStart}
    `;

    return {
        newOrganizations,
        pendingOrganizations,
        firstSales: firstSaleRows.length,
        eventsCreated,
        salesConfirmed,
        ticketsSold,
        refunded,
        chargedBack,
        volumeAlertsFired,
    };
}

function buildDigestEmail(stats, windowHours) {
    const subject = `[PaseCultural] Resumen diario Developer — últimas ${windowHours}h`;
    const rows = [
        ["Organizaciones nuevas", stats.newOrganizations],
        ["Organizaciones pendientes (actual)", stats.pendingOrganizations],
        ["Primeras ventas", stats.firstSales],
        ["Eventos creados", stats.eventsCreated],
        ["Ventas confirmadas", stats.salesConfirmed],
        ["Tickets emitidos", stats.ticketsSold],
        ["Refunds", stats.refunded],
        ["Chargebacks", stats.chargedBack],
        ["Alertas de volumen disparadas", stats.volumeAlertsFired],
    ];

    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#1e3a8a;padding:16px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;">📊 Resumen diario Developer — PaseCultural</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">
                <p style="margin:0 0 16px;">Actividad de la plataforma en las últimas ${windowHours} horas.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
                  ${rows
                      .map(([labelText, value]) => `<tr><td style="padding:6px 0;color:#6b7280;">${escapeHtml(labelText)}</td><td style="padding:6px 0;"><strong>${escapeHtml(String(value))}</strong></td></tr>`)
                      .join("")}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = [`PaseCultural — Resumen diario Developer (últimas ${windowHours}h)`, "", ...rows.map(([labelText, value]) => `${labelText}: ${value}`)].join("\n");

    return { subject, html, text };
}

// Punto de entrada único — esto es lo que Render Cron (o cualquier otro
// disparador futuro) debe invocar una vez por día. Best-effort: nunca
// lanza, mismo criterio que sendDeveloperAlert.
export async function generateAndSendDeveloperDailyDigest() {
    if (!process.env.DEVELOPER_ALERT_EMAIL?.trim()) {
        logger.warn("generateAndSendDeveloperDailyDigest: DEVELOPER_ALERT_EMAIL no está configurada — no se generó ningún digest");
        return { sent: false, reason: "developer_alert_email_not_configured" };
    }

    try {
        const windowStart = new Date(Date.now() - DIGEST_WINDOW_HOURS * 60 * 60 * 1000);
        const stats = await collectDailyDigestStats(windowStart);

        const to = getDeveloperAlertEmail();
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = buildDigestEmail(stats, DIGEST_WINDOW_HOURS);

        const resend = getResendClient();
        const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

        if (result.error) {
            logger.error("generateAndSendDeveloperDailyDigest: Resend devolvió un error", { errorName: result.error.name });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("generateAndSendDeveloperDailyDigest: enviado", { providerId: result.data?.id, stats });
        return { sent: true, providerId: result.data?.id, stats };
    } catch (err) {
        logger.error("generateAndSendDeveloperDailyDigest: intento fallido", { errorName: err?.name || "Error", errorMessage: err?.message });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}
