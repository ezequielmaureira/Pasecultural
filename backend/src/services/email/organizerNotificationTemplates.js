import { escapeHtml } from "../../utils/htmlEscape.js";

// Notificaciones Organizer — mismo criterio visual que
// sendOrganizerWithdrawalRequestAlert.service.js (branding real de
// PaseCultural: estos emails los ve el organizador, a diferencia de las
// Alertas Developer, que son internas). Un único builder de esqueleto
// reusado por todos los tipos de abajo, en vez de repetir la misma tabla —
// mismo criterio que buildDeveloperAlertEmail (developerAlertTemplates.js).
// NUNCA incluye: access/refresh tokens de Mercado Pago, OTP, DNI completo,
// bearer tokens (publicRecoveryToken, invitationToken, etc.) ni datos de
// otra organización — ver el informe de entrega, sección "Datos sensibles".
function buildOrganizerNotificationEmail({ badge, title, intro, rows, ctaLabel, ctaUrl }) {
    const subject = `[PaseCultural] ${title}`;

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
                <p style="margin:0 0 12px;font-weight:bold;">${escapeHtml(badge)}</p>
                <p style="margin:0 0 16px;">${intro}</p>
                ${
                    rows.length > 0
                        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;margin-bottom:16px;">
                  ${rows
                      .map(
                          ([labelText, value]) =>
                              `<tr><td style="padding:6px 0;color:#6b7280;">${escapeHtml(labelText)}</td><td style="padding:6px 0;">${escapeHtml(String(value))}</td></tr>`
                      )
                      .join("")}
                </table>`
                        : ""
                }
                ${ctaUrl ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;">${escapeHtml(ctaLabel ?? "Ver en PaseCultural")}</a>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = [
        `PaseCultural — ${title}`,
        "",
        intro.replace(/<[^>]+>/g, ""),
        "",
        ...rows.map(([labelText, value]) => `${labelText}: ${value}`),
        ...(ctaUrl ? ["", `${ctaLabel ?? "Ver en PaseCultural"}: ${ctaUrl}`] : []),
    ].join("\n");

    return { subject, html, text };
}

export function buildSaleConfirmedEmail({ eventTitle, functionDate, venue, ticketCount, ticketSummary, total }) {
    return buildOrganizerNotificationEmail({
        badge: "🎟️ Venta confirmada",
        title: `Venta confirmada — ${eventTitle}`,
        intro: `Se confirmó una venta para <strong>${escapeHtml(eventTitle)}</strong>.`,
        rows: [
            ["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`],
            ["Entradas", ticketCount],
            ["Tipos", ticketSummary],
            ...(total != null ? [["Importe total", `$${Number(total).toLocaleString("es-AR")}`]] : []),
        ],
    });
}

// Por EVENTO (nunca sumado entre eventos de la misma organización, ver el
// comentario en sale.service.js) — el email tiene que dejar clarísimo DE
// QUÉ evento se trata, nunca sólo un número suelto de la organización.
export function buildSalesMilestoneEmail({ eventTitle, milestone, soldCount }) {
    return buildOrganizerNotificationEmail({
        badge: "📈 Hito de ventas",
        title: `${eventTitle} llegó a ${milestone} entradas vendidas`,
        intro: `Tu evento <strong>${escapeHtml(eventTitle)}</strong> superó las <strong>${milestone}</strong> entradas vendidas.`,
        rows: [
            ["Evento", eventTitle],
            ["Hito alcanzado", `${milestone} entradas`],
            ["Vendidas hasta ahora", soldCount],
        ],
    });
}

export function buildLowStockEmail({ eventTitle, ticketTypeName, venue, functionDate, remaining, percent }) {
    return buildOrganizerNotificationEmail({
        badge: "⚠️ Stock bajo",
        title: `Stock bajo — ${ticketTypeName} (${eventTitle})`,
        intro: `Quedan pocas entradas de <strong>${escapeHtml(ticketTypeName)}</strong> para <strong>${escapeHtml(eventTitle)}</strong>.`,
        rows: [
            ["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`],
            ["Disponibles", remaining],
            ["Umbral configurado", `${percent}%`],
        ],
    });
}

export function buildSoldOutEmail({ eventTitle, ticketTypeName, venue, functionDate }) {
    return buildOrganizerNotificationEmail({
        badge: "🔴 Entradas agotadas",
        title: `Se agotaron las entradas ${ticketTypeName} para ${eventTitle}`,
        intro: `Se agotaron las entradas <strong>${escapeHtml(ticketTypeName)}</strong> para <strong>${escapeHtml(eventTitle)}</strong>.`,
        rows: [["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`]],
    });
}

export function buildEventReminderEmail({ eventTitle, venue, functionDate, hoursBefore }) {
    return buildOrganizerNotificationEmail({
        badge: "⏰ Recordatorio de función",
        title: `Tu función de ${eventTitle} se acerca`,
        intro: `Faltan aproximadamente <strong>${hoursBefore} horas</strong> para tu función de <strong>${escapeHtml(eventTitle)}</strong>.`,
        rows: [["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`]],
    });
}

export function buildEventStartedEmail({ eventTitle, venue, functionDate }) {
    return buildOrganizerNotificationEmail({
        badge: "▶️ La función comenzó",
        title: `Comenzó tu función de ${eventTitle}`,
        intro: `Tu función de <strong>${escapeHtml(eventTitle)}</strong> acaba de comenzar.`,
        rows: [["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`]],
    });
}

export function buildEventEndedEmail({ eventTitle, venue, functionDate }) {
    return buildOrganizerNotificationEmail({
        badge: "⏹️ La función terminó",
        title: `Terminó tu función de ${eventTitle}`,
        intro: `Tu función de <strong>${escapeHtml(eventTitle)}</strong> acaba de terminar.`,
        rows: [["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`]],
    });
}

export function buildScannerActivityMilestoneEmail({ eventTitle, venue, functionDate, percent, checkedIn, capacity }) {
    return buildOrganizerNotificationEmail({
        badge: "🚪 Ingresos al evento",
        title: `${percent}% de las entradas ya ingresaron — ${eventTitle}`,
        intro: `Ya ingresó el <strong>${percent}%</strong> de las entradas de tu función de <strong>${escapeHtml(eventTitle)}</strong>.`,
        rows: [
            ["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`],
            ["Ingresados", `${checkedIn} / ${capacity}`],
        ],
    });
}

// Botón de arrepentimiento — generalizado acá desde
// sendOrganizerWithdrawalRequestAlert.service.js (ver el informe de
// entrega): mismo contenido de siempre más fecha de función/cantidad/tipos
// de entrada afectados, que el email anterior no incluía. NUNCA incluye
// OTP, DNI, tokens — sólo datos ya conocidos por el organizador (título del
// evento, motivo elegido, fecha, cantidad y tipos de entrada de ESA venta).
export function buildWithdrawalRequestEmail({ eventTitle, functionDate, venue, reason, reasonNote, ticketCount, ticketSummary, requestsUrl }) {
    const reasonLabel = reason ?? "Sin especificar";
    return buildOrganizerNotificationEmail({
        badge: "↩️ Nueva solicitud de arrepentimiento",
        title: `Nueva solicitud de arrepentimiento — ${eventTitle}`,
        intro: `Un comprador registró una solicitud de arrepentimiento/devolución para tu evento <strong>${escapeHtml(eventTitle)}</strong>. Esto es sólo una solicitud registrada — no implica que el reembolso ya esté aprobado ni que PaseCultural haya tomado ninguna acción financiera.`,
        rows: [
            ["Función", `${new Date(functionDate).toLocaleString("es-AR")} · ${venue}`],
            ["Motivo", reasonLabel],
            ...(reasonNote ? [["Comentario", reasonNote]] : []),
            ["Entradas afectadas", ticketCount],
            ["Tipos de entrada", ticketSummary],
        ],
        ctaLabel: "Ver solicitudes",
        ctaUrl: requestsUrl,
    });
}

export function buildMercadoPagoDisconnectedForOrganizerEmail({ organizationName }) {
    return buildOrganizerNotificationEmail({
        badge: "🔌 Mercado Pago desconectado",
        title: "Tu cuenta de Mercado Pago se desconectó",
        intro: `La cuenta de Mercado Pago de <strong>${escapeHtml(organizationName)}</strong> quedó desconectada. Mientras tanto, tu checkout con Mercado Pago no va a funcionar — volvé a conectarla desde tu panel para seguir vendiendo con tarjeta/Mercado Pago.`,
        rows: [],
    });
}

export function buildMercadoPagoReauthNeededEmail({ organizationName }) {
    return buildOrganizerNotificationEmail({
        badge: "⚠️ Mercado Pago necesita reconexión",
        title: "Tu cuenta de Mercado Pago necesita que la reconectes",
        intro: `No pudimos renovar el acceso a la cuenta de Mercado Pago de <strong>${escapeHtml(organizationName)}</strong> (la autorización quedó inválida o fue revocada). Reconectá tu cuenta desde tu panel para que el checkout con Mercado Pago siga funcionando.`,
        rows: [],
    });
}
