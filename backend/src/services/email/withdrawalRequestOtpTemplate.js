import { escapeHtml } from "../../utils/htmlEscape.js";

// Botón de arrepentimiento — mismo criterio visual EXACTO que
// saleRecoveryVerificationTemplate.js (HTML con estilos inline + versión
// text/plain, sin personalizar por evento/nombre porque un mismo código
// puede corresponder a más de una compra, ver findWithdrawalEligibleSales).
// A propósito NUNCA muestra DNI ni ningún dato de otras compras — sólo el
// código y su expiración (ver el informe de entrega, sección "Email OTP").
const BRAND_VIOLET = "#7c3aed";
const TEXT_DARK = "#111827";
const TEXT_MUTED = "#6b7280";
const BORDER = "#e5e7eb";

export function buildWithdrawalRequestOtpEmail({ code }) {
    const subject = `PaseCultural - Código para gestionar tu compra: ${code}`;
    const preheader = "Usá este código para gestionar tu compra.";

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
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#0B1120;padding:20px 24px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
                  Pase<span style="color:#a78bfa;">Cultural</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
                <h1 style="margin:0 0 12px;font-size:18px;color:${TEXT_DARK};">Gestionar mi compra</h1>
                <p style="margin:0 0 20px;font-size:14px;color:${TEXT_DARK};line-height:1.5;">
                  Usá este código para gestionar tu compra en PaseCultural (solicitud de arrepentimiento/devolución).
                </p>
                <div style="margin:0 0 20px;">
                  <span style="display:inline-block;background-color:#f5f3ff;color:${BRAND_VIOLET};font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px 24px;border-radius:10px;">
                    ${escapeHtml(code)}
                  </span>
                </div>
                <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
                  Este código vence en 10 minutos. Si vos no pediste este código, ignorá este correo.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
                  Este es un email transaccional de PaseCultural. No es publicidad ni una suscripción.
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
        "Gestionar mi compra",
        "",
        "Usá este código para gestionar tu compra en PaseCultural (solicitud de arrepentimiento/devolución).",
        "",
        `Código: ${code}`,
        "",
        "Este código vence en 10 minutos. Si vos no pediste este código, ignorá este correo.",
    ].join("\n");

    return { subject, html, text };
}
