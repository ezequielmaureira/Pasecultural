import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { withTimeout } from "../../utils/withTimeout.js";
import { escapeHtml } from "../../utils/htmlEscape.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de envíos por Resend

// Botón de arrepentimiento — aviso al organizador cuando se registra una
// solicitud NUEVA (nunca en el caso "ya existía una activa", ver
// withdrawalRequest.service.js). Deliberadamente UNA función chica y
// autocontenida en vez de una infraestructura de "Alertas Organizer"
// generalizada — el usuario pidió explícitamente no construir eso todavía
// (va a haber una ronda completa dedicada más adelante). Reusa
// getResendClient/getEmailConfig/withTimeout tal cual, mismo patrón que
// sendMercadoPagoReconciliationAlert.service.js. Best-effort: nunca lanza,
// un fallo acá nunca puede impedir que la solicitud quede registrada.
export async function sendOrganizerWithdrawalRequestAlert({ to, eventTitle, reason, reasonNote, requestsUrl }) {
    try {
        const { from, replyTo } = getEmailConfig();
        const subject = `[PaseCultural] Nueva solicitud de arrepentimiento — ${eventTitle}`;
        const reasonLabel = reason ?? "Sin especificar";

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
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#0B1120;padding:16px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;">Pase<span style="color:#a78bfa;">Cultural</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">
                <p style="margin:0 0 16px;">Un comprador registró una solicitud de arrepentimiento/devolución para tu evento <strong>${escapeHtml(eventTitle)}</strong>.</p>
                <p style="margin:0 0 16px;">Motivo: <strong>${escapeHtml(reasonLabel)}</strong>${reasonNote ? `<br/>Comentario: ${escapeHtml(reasonNote)}` : ""}</p>
                <p style="margin:0 0 16px;font-size:12px;color:#6b7280;">Esto es sólo una solicitud registrada — no implica que el reembolso ya esté aprobado ni que PaseCultural haya tomado ninguna acción financiera.</p>
                <a href="${escapeHtml(requestsUrl)}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;">Ver solicitudes</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

        const text = [
            "PaseCultural — Nueva solicitud de arrepentimiento",
            "",
            `Un comprador registró una solicitud de arrepentimiento/devolución para tu evento ${eventTitle}.`,
            `Motivo: ${reasonLabel}`,
            ...(reasonNote ? [`Comentario: ${reasonNote}`] : []),
            "",
            "Esto es sólo una solicitud registrada — no implica que el reembolso ya esté aprobado ni que PaseCultural haya tomado ninguna acción financiera.",
            "",
            `Ver solicitudes: ${requestsUrl}`,
        ].join("\n");

        const resend = getResendClient();
        const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

        if (result.error) {
            logger.error("sendOrganizerWithdrawalRequestAlert: Resend devolvió un error", { errorName: result.error.name });
            return { sent: false, reason: result.error.name || "resend_error" };
        }

        logger.info("sendOrganizerWithdrawalRequestAlert: enviada", { providerId: result.data?.id });
        return { sent: true, providerId: result.data?.id };
    } catch (err) {
        logger.error("sendOrganizerWithdrawalRequestAlert: intento fallido", { errorName: err?.name || "Error", errorMessage: err?.message });
        return { sent: false, reason: err?.message === "resend_timeout" ? "resend_timeout" : "send_failed" };
    }
}
