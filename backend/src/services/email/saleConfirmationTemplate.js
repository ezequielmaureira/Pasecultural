import { escapeHtml } from "../../utils/htmlEscape.js";
import { formatFunctionDateTimeAR } from "./formatDateAR.js";

// Plantilla del email de confirmación de compra: sólo HTML con estilos
// inline (tablas, no flex/grid) + una versión text/plain — nada de CSS
// externo ni JS, para que se vea razonablemente igual en la mayor cantidad
// de clientes de correo posible (Gmail, Outlook, Apple Mail...). El fondo
// claro (no el oscuro de la app) es deliberado: el soporte de dark-mode
// entre clientes de correo es inconsistente, así que un fondo claro con el
// violeta de marca como acento es la opción que se ve bien en todos lados.
const BRAND_VIOLET = "#7c3aed";
const TEXT_DARK = "#111827";
const TEXT_MUTED = "#6b7280";
const BORDER = "#e5e7eb";

function ticketCardHtml(ticket, contentId, index) {
    return `
    <tr>
      <td style="padding:16px 0;border-top:1px solid ${BORDER};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="120" valign="top" style="padding-right:16px;">
              <img src="cid:${contentId}" alt="Código QR de la entrada ${index + 1}" width="110" height="110" style="display:block;border:1px solid ${BORDER};border-radius:8px;" />
            </td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT_DARK};line-height:1.5;">
              <strong>${escapeHtml(ticket.eventTitle)}</strong><br />
              <span style="color:${TEXT_MUTED};">${escapeHtml(formatFunctionDateTimeAR(ticket.functionDate))}</span><br />
              <span style="color:${TEXT_MUTED};">${escapeHtml(ticket.venue)}</span><br />
              <span style="color:${TEXT_MUTED};">Tipo: ${escapeHtml(ticket.ticketTypeName)}</span><br />
              <span style="color:${TEXT_MUTED};">Entrada N°: ${escapeHtml(ticket.ticketNumber)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function ticketTextBlock(ticket) {
    return [
        `- ${ticket.eventTitle}`,
        `  ${formatFunctionDateTimeAR(ticket.functionDate)}`,
        `  ${ticket.venue}`,
        `  Tipo: ${ticket.ticketTypeName}`,
        `  Entrada N°: ${ticket.ticketNumber}`,
    ].join("\n");
}

// `data` viene de getSaleEmailData() (ver sendSaleConfirmationEmail.service.js).
// `qrContentIds` mapea ticket.id -> contentId, en el mismo orden que los
// adjuntos inline que arma ese mismo service — nunca se recalcula acá.
export function buildSaleConfirmationEmail({ buyerFirstName, eventTitle, tickets, recoverPurchaseUrl, replyTo }, qrContentIds) {
    const subject = `Tus entradas para ${eventTitle} | PaseCultural`;
    const preheader = "Tu compra fue confirmada. Guardá tus entradas para ingresar al evento.";
    const greetingName = buyerFirstName?.trim() ? escapeHtml(buyerFirstName.trim()) : "";

    const ticketsHtml = tickets
        .map((ticket, index) => ticketCardHtml(ticket, qrContentIds.get(ticket.id), index))
        .join("");

    const supportLine = replyTo
        ? `<p style="margin:0 0 8px;">¿Necesitás ayuda? Escribinos a <a href="mailto:${escapeHtml(replyTo)}" style="color:${BRAND_VIOLET};">${escapeHtml(replyTo)}</a>.</p>`
        : "";

    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#0B1120;padding:20px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
                  Pase<span style="color:#a78bfa;">Cultural</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;">
                <h1 style="margin:0 0 12px;font-size:20px;color:${TEXT_DARK};">¡Tu compra fue confirmada!</h1>
                <p style="margin:0 0 16px;font-size:14px;color:${TEXT_DARK};line-height:1.5;">
                  Hola${greetingName ? " " + greetingName : ""}. Estas son tus entradas para <strong>${escapeHtml(eventTitle)}</strong>.
                  Podés mostrarlas desde tu teléfono o descargar el PDF adjunto.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${ticketsHtml}
                </table>

                <p style="margin:20px 0 8px;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
                  No compartas tus códigos QR: son personales e intransferibles y son lo único que valida tu ingreso al evento.
                </p>
                ${supportLine}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid ${BORDER};">
                <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
                  ¿Perdiste este correo? Podés recuperar tus entradas iniciando sesión en
                  <a href="${recoverPurchaseUrl}" style="color:${TEXT_MUTED};text-decoration:underline;">PaseCultural</a>.
                </p>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
                  Este es un email transaccional enviado por una compra realizada en PaseCultural. No es publicidad ni una suscripción.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = [
        "PaseCultural",
        "",
        "¡Tu compra fue confirmada!",
        "",
        `Hola${buyerFirstName?.trim() ? " " + buyerFirstName.trim() : ""}.`,
        `Estas son tus entradas para ${eventTitle}. Podés mostrarlas desde tu teléfono o descargar el PDF adjunto.`,
        "",
        ...tickets.map(ticketTextBlock),
        "",
        "No compartas tus códigos QR: son personales e intransferibles.",
        replyTo ? `¿Necesitás ayuda? Escribinos a ${replyTo}.` : "",
        "",
        `¿Perdiste este correo? Podés recuperar tus entradas iniciando sesión en PaseCultural: ${recoverPurchaseUrl}`,
        "",
        "Este es un email transaccional enviado por una compra realizada en PaseCultural.",
    ]
        .filter(Boolean)
        .join("\n");

    return { subject, html, text };
}
