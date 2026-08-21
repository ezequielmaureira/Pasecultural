import { escapeHtml } from "../../utils/htmlEscape.js";

// Alertas Developer — mismo criterio visual que
// mercadoPagoReconciliationAlertTemplate.js (alerta interna, nunca la ve
// comprador/organizador: sin diseño de marca, sólo legible rápido). Un
// único builder de esqueleto HTML/text reusado por los 10 tipos de alerta
// de abajo, en vez de repetir la misma tabla 10 veces — nunca se agregan
// datos del comprador (nombre/email/DNI/teléfono) ni credenciales de
// ningún tipo (ver auditoría, sección "Privacidad").
function buildDeveloperAlertEmail({ badge, title, intro, rows }) {
    const subject = `[PaseCultural] ${title}`;
    const occurredAt = new Date().toISOString();
    const allRows = [...rows, ["Momento de la alerta", occurredAt]];

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
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;">
                  ${escapeHtml(badge)} — PaseCultural
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">
                <p style="margin:0 0 16px;">${intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
                  ${allRows
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

    const text = [`PaseCultural — ${title}`, "", intro.replace(/<[^>]+>/g, ""), "", ...allRows.map(([labelText, value]) => `${labelText}: ${value}`)].join("\n");

    return { subject, html, text };
}

export function buildNewOrganizationPendingEmail({ organizationId, name, status, createdAt }) {
    return buildDeveloperAlertEmail({
        badge: "🏢 Nueva organización pendiente",
        title: `Nueva organización pendiente de verificación (${name})`,
        intro: "Una organización nueva entró al estado <strong>PENDING</strong> — todavía no fue aprobada. Revisala en Developer &gt; Organizaciones.",
        rows: [
            ["Organization ID", organizationId],
            ["Nombre", name],
            ["Estado", status],
            ["Creada", createdAt.toISOString()],
        ],
    });
}

export function buildMercadoPagoFirstConnectionEmail({ organizationId, organizationName, connectedAt }) {
    return buildDeveloperAlertEmail({
        badge: "🔗 Mercado Pago conectado por primera vez",
        title: `Mercado Pago conectado por primera vez (${organizationName})`,
        intro: "Una organización conectó una cuenta de Mercado Pago <strong>por primera vez en su historia</strong> (nunca antes había tenido ninguna conexión, ni siquiera desconectada). Las reconexiones posteriores NO generan esta alerta.",
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Conectada", connectedAt.toISOString()],
        ],
    });
}

export function buildMercadoPagoDisconnectedEmail({ organizationId, organizationName, connectionId, disconnectedAt }) {
    return buildDeveloperAlertEmail({
        badge: "🔌 Mercado Pago desconectado",
        title: `Mercado Pago desconectado (${organizationName})`,
        intro: "Una organización desconectó su cuenta de Mercado Pago. El checkout de esa organización queda inhabilitado hasta que vuelva a conectar.",
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ...(connectionId ? [["MercadoPagoConnection ID", connectionId]] : []),
            ["Desconectada", disconnectedAt.toISOString()],
        ],
    });
}

export function buildFirstConfirmedSaleEmail({ organizationId, organizationName, saleId, confirmedAt }) {
    return buildDeveloperAlertEmail({
        badge: "🎉 Primera venta confirmada",
        title: `Primera venta confirmada (${organizationName})`,
        intro: "Una organización consiguió su <strong>primera Sale CONFIRMED</strong>. Esta alerta se manda una única vez por organización — las ventas siguientes no generan un email nuevo.",
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Sale ID", saleId],
            ["Confirmada", confirmedAt.toISOString()],
        ],
    });
}

export function buildFinancialInvariantBrokenEmail({ reason, saleId, paymentId, eventId, organizationId, detail }) {
    return buildDeveloperAlertEmail({
        badge: "🚨 Invariante financiera rota",
        title: `Invariante financiera rota — ${reason} (Sale ${saleId})`,
        intro: "Se detectó una situación que <strong>nunca debería ocurrir</strong> en el procesamiento de un pago de Mercado Pago. Requiere revisión manual de Developer — no se tomó ninguna acción automática además de rechazar la operación en curso.",
        rows: [
            ["Motivo", reason],
            ["Sale ID", saleId],
            ...(paymentId ? [["Payment ID (Mercado Pago)", String(paymentId)]] : []),
            ...(eventId ? [["Event ID", eventId]] : []),
            ...(organizationId ? [["Organization ID", organizationId]] : []),
            ...(detail ? [["Detalle técnico", String(detail)]] : []),
        ],
    });
}

export function buildHighTicketPriceEmail({ organizationId, organizationName, eventId, eventTitle, tickets, threshold }) {
    return buildDeveloperAlertEmail({
        badge: "💰 Entrada con precio excepcionalmente alto",
        title: `Entrada con precio excepcionalmente alto (${eventTitle})`,
        intro: `Una organización configuró una o más entradas con un precio autoritativo por encima del umbral configurado ($${threshold}). Puramente informativo — la venta de esa entrada no genera una alerta aparte.`,
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Event ID", eventId],
            ["Evento", eventTitle],
            ["Umbral configurado", `$${threshold}`],
            ["Entradas por encima del umbral", tickets.map((t) => `${t.name}: $${t.price}`).join(" | ")],
        ],
    });
}

export function buildHighQuantitySaleEmail({ organizationId, organizationName, saleId, eventId, quantity, threshold }) {
    return buildDeveloperAlertEmail({
        badge: "🎫 Compra con cantidad excepcionalmente alta",
        title: `Compra con cantidad excepcionalmente alta de entradas (${quantity})`,
        intro: `Una Sale CONFIRMED superó el umbral configurado de cantidad total de entradas por compra (${threshold}). Puramente informativo.`,
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Sale ID", saleId],
            ["Event ID", eventId],
            ["Cantidad de entradas", String(quantity)],
            ["Umbral configurado", String(threshold)],
        ],
    });
}

export function buildTooManyEventsEmail({ organizationId, organizationName, count, windowHours, threshold }) {
    return buildDeveloperAlertEmail({
        badge: "📅 Muchos eventos creados",
        title: `Organización creó muchos eventos en poco tiempo (${organizationName})`,
        intro: `Una organización creó ${count} eventos en las últimas ${windowHours} horas, por encima del umbral configurado (${threshold}). Puramente informativo — no bloquea la creación de más eventos.`,
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Eventos creados", `${count} en ${windowHours}h`],
            ["Umbral configurado", `${threshold} en ${windowHours}h`],
        ],
    });
}

export function buildSalesVolumeSpikeEmail({ organizationId, organizationName, count, windowMinutes, threshold }) {
    return buildDeveloperAlertEmail({
        badge: "📈 Pico de ventas",
        title: `Pico de ventas confirmadas (${organizationName})`,
        intro: `Una organización acumuló ${count} ventas CONFIRMED en los últimos ${windowMinutes} minutos, por encima del umbral configurado (${threshold}). Esta alerta tiene cooldown — no se manda una vez por cada venta adicional mientras el volumen se mantenga alto.`,
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Ventas observadas", `${count} en ${windowMinutes}min`],
            ["Umbral configurado", `${threshold} en ${windowMinutes}min`],
        ],
    });
}

export function buildRefundsVolumeSpikeEmail({ organizationId, organizationName, count, windowHours, threshold }) {
    return buildDeveloperAlertEmail({
        badge: "↩️ Refunds anormalmente frecuentes",
        title: `Refunds anormalmente frecuentes (${organizationName})`,
        intro: `Una organización acumuló ${count} refunds en las últimas ${windowHours} horas, por encima del umbral configurado (${threshold}). Alerta de patrón/volumen — no reemplaza ni duplica la alerta individual de reversión ya existente por Mercado Pago.`,
        rows: [
            ["Organization ID", organizationId],
            ["Organización", organizationName],
            ["Refunds observados", `${count} en ${windowHours}h`],
            ["Umbral configurado", `${threshold} en ${windowHours}h`],
        ],
    });
}
