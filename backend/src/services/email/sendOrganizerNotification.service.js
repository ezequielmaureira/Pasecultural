import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { withTimeout } from "../../utils/withTimeout.js";
import {
    buildSaleConfirmedEmail,
    buildSalesMilestoneEmail,
    buildLowStockEmail,
    buildSoldOutEmail,
    buildEventReminderEmail,
    buildEventStartedEmail,
    buildEventEndedEmail,
    buildScannerActivityMilestoneEmail,
    buildWithdrawalRequestEmail,
    buildMercadoPagoDisconnectedForOrganizerEmail,
    buildMercadoPagoReauthNeededEmail,
} from "./organizerNotificationTemplates.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de envíos por Resend de este proyecto

// Notificaciones Organizer — bloque definitivo (Dashboard Organizador >
// Configuración > Notificaciones). Generaliza el envío que antes vivía
// sólo en sendOrganizerWithdrawalRequestAlert.service.js (ver el informe de
// entrega) a los ~11 tipos de este bloque, mismo esqueleto que
// sendDeveloperAlert.service.js: SIEMPRE best-effort, nunca lanza, nunca
// puede revertir ni bloquear la operación que la dispara.
export const OrganizerNotificationType = Object.freeze({
    SALE_CONFIRMED: "SALE_CONFIRMED",
    SALES_MILESTONE: "SALES_MILESTONE",
    LOW_STOCK: "LOW_STOCK",
    SOLD_OUT: "SOLD_OUT",
    EVENT_REMINDER: "EVENT_REMINDER",
    EVENT_STARTED: "EVENT_STARTED",
    EVENT_ENDED: "EVENT_ENDED",
    SCANNER_ACTIVITY_MILESTONE: "SCANNER_ACTIVITY_MILESTONE",
    WITHDRAWAL_REQUEST: "WITHDRAWAL_REQUEST",
    MERCADOPAGO_DISCONNECTED: "MERCADOPAGO_DISCONNECTED",
    MERCADOPAGO_REAUTH_NEEDED: "MERCADOPAGO_REAUTH_NEEDED",
});

const TEMPLATE_BUILDERS = {
    [OrganizerNotificationType.SALE_CONFIRMED]: buildSaleConfirmedEmail,
    [OrganizerNotificationType.SALES_MILESTONE]: buildSalesMilestoneEmail,
    [OrganizerNotificationType.LOW_STOCK]: buildLowStockEmail,
    [OrganizerNotificationType.SOLD_OUT]: buildSoldOutEmail,
    [OrganizerNotificationType.EVENT_REMINDER]: buildEventReminderEmail,
    [OrganizerNotificationType.EVENT_STARTED]: buildEventStartedEmail,
    [OrganizerNotificationType.EVENT_ENDED]: buildEventEndedEmail,
    [OrganizerNotificationType.SCANNER_ACTIVITY_MILESTONE]: buildScannerActivityMilestoneEmail,
    [OrganizerNotificationType.WITHDRAWAL_REQUEST]: buildWithdrawalRequestEmail,
    [OrganizerNotificationType.MERCADOPAGO_DISCONNECTED]: buildMercadoPagoDisconnectedForOrganizerEmail,
    [OrganizerNotificationType.MERCADOPAGO_REAUTH_NEEDED]: buildMercadoPagoReauthNeededEmail,
};

// Best-effort SIEMPRE — mismo criterio que sendDeveloperAlert. `to` viene
// SIEMPRE del caller (Organization.email real de la organización dueña del
// evento/venta/conexión en cuestión) — este archivo nunca resuelve
// destinatarios por su cuenta, así que no puede filtrar notificaciones de
// una organización hacia el email de otra.
export async function sendOrganizerNotification(type, { to, ...payload }) {
    const builder = TEMPLATE_BUILDERS[type];
    if (!builder) {
        logger.error(new Error(`sendOrganizerNotification: tipo desconocido "${type}"`), { type });
        return { sent: false, reason: "unknown_notification_type" };
    }
    if (!to) {
        logger.warn("sendOrganizerNotification: sin email de destino, no se manda", { type });
        return { sent: false, reason: "no_recipient" };
    }

    try {
        const { from, replyTo } = getEmailConfig();
        const { subject, html, text } = builder(payload);

        const resend = getResendClient();
        const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

        if (result.error) {
            logger.error("sendOrganizerNotification: Resend devolvió un error", { type, errorName: result.error.name });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendOrganizerNotification: enviada", { type, providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendOrganizerNotification: intento fallido", { type, errorName: err?.name || "Error", errorMessage: err?.message });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}
