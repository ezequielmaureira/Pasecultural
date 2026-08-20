import { escapeHtml } from "../../utils/htmlEscape.js";

// Alerta interna (nunca la ve el comprador) — sin diseño de marca, sólo
// necesita ser legible rápido para soporte/developer. A propósito NUNCA
// incluye datos del comprador (nombre/email/DNI/teléfono): con
// saleId+paymentId+eventId alcanza para localizar el caso en Developer >
// Ventas (filtro "Requiere conciliación") y decidir la reconciliación
// manual — ver auditoría.
export function buildMercadoPagoReconciliationAlertEmail({ saleId, paymentId, eventId }) {
    const subject = `[PaseCultural] Reconciliación requerida — pago aprobado sin stock (Sale ${saleId})`;

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
              <td style="background-color:#7c2d12;padding:16px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;">
                  ⚠ Reconciliación requerida — PaseCultural
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">
                <p style="margin:0 0 16px;">
                  Mercado Pago informó un pago <strong>aprobado</strong> que PaseCultural no pudo cumplir por falta
                  de stock. La venta quedó <strong>PENDING</strong>, sin entradas emitidas, y requiere conciliación
                  manual.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Motivo</td>
                    <td style="padding:6px 0;"><strong>INSUFFICIENT_STOCK</strong></td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Sale ID</td>
                    <td style="padding:6px 0;"><code>${escapeHtml(saleId)}</code></td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Payment ID (Mercado Pago)</td>
                    <td style="padding:6px 0;"><code>${escapeHtml(String(paymentId))}</code></td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Event ID</td>
                    <td style="padding:6px 0;"><code>${escapeHtml(eventId)}</code></td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">
                  Buscala en Developer &gt; Ventas con el filtro "Requiere conciliación".
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
        "PaseCultural — Reconciliación requerida",
        "",
        "Mercado Pago informó un pago aprobado que PaseCultural no pudo cumplir por falta de stock.",
        "La venta quedó PENDING, sin entradas emitidas, y requiere conciliación manual.",
        "",
        "Motivo: INSUFFICIENT_STOCK",
        `Sale ID: ${saleId}`,
        `Payment ID (Mercado Pago): ${paymentId}`,
        `Event ID: ${eventId}`,
        "",
        'Buscala en Developer > Ventas con el filtro "Requiere conciliación".',
    ].join("\n");

    return { subject, html, text };
}

// Alerta interna de reversión financiera (refund/chargeback) — ver
// mercadoPagoWebhook.service.js, bloque REVERSAL_STATUSES. Puramente
// informativa: la invalidación de tickets ACTIVE→REFUNDED ya ocurrió antes
// de armar este email (nunca la dispara este archivo). Mismo criterio que
// buildMercadoPagoReconciliationAlertEmail — NUNCA datos del comprador,
// alcanza con saleId+paymentId+eventId(+organizationId) para localizar el
// caso.
const REVERSAL_LABELS = {
    REFUNDED: { subjectText: "Pago reembolsado", bodyVerb: "reembolsado" },
    CHARGED_BACK: { subjectText: "Contracargo detectado", bodyVerb: "objeto de un contracargo" },
};

export function buildMercadoPagoReversalAlertEmail({ type, saleId, paymentId, eventId, organizationId, ticketsAffected }) {
    const label = REVERSAL_LABELS[type] ?? REVERSAL_LABELS.REFUNDED;
    const subject = `[PaseCultural] Mercado Pago - ${label.subjectText} (Sale ${saleId})`;
    const occurredAt = new Date().toISOString();

    const rows = [
        ["Tipo", type],
        ["Sale ID", saleId],
        ["Payment ID (Mercado Pago)", String(paymentId)],
        ["Event ID", eventId],
        ...(organizationId ? [["Organization ID", organizationId]] : []),
        ["Tickets afectados en esta ejecución", String(ticketsAffected)],
        ["Momento de la alerta", occurredAt],
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
              <td style="background-color:#7c2d12;padding:16px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;">
                  ⚠ ${escapeHtml(label.subjectText)} — PaseCultural
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">
                <p style="margin:0 0 16px;">
                  Mercado Pago informó que un pago fue <strong>${escapeHtml(label.bodyVerb)}</strong>. Las entradas
                  ACTIVE de esta venta ya fueron pasadas automáticamente a REFUNDED — esta alerta es sólo
                  informativa, no requiere ninguna acción financiera.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
                  ${rows
                      .map(
                          ([labelText, value]) =>
                              `<tr><td style="padding:6px 0;color:#6b7280;">${escapeHtml(labelText)}</td><td style="padding:6px 0;"><code>${escapeHtml(String(value))}</code></td></tr>`
                      )
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

    const text = [
        `PaseCultural — ${label.subjectText}`,
        "",
        `Mercado Pago informó que un pago fue ${label.bodyVerb}.`,
        "Las entradas ACTIVE de esta venta ya fueron pasadas automáticamente a REFUNDED — esta alerta es sólo informativa.",
        "",
        ...rows.map(([labelText, value]) => `${labelText}: ${value}`),
    ].join("\n");

    return { subject, html, text };
}
