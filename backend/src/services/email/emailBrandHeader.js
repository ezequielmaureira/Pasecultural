// Encabezado/wordmark de Smarticket compartido por los templates de email
// que usan el mismo header visual byte-a-byte (fondo #0B1120, "Smart" en
// blanco + "icket" en violeta #a78bfa, font-size 18px). Sólo el padding
// varía entre templates, así que es el único parámetro. Templates con un
// header visualmente distinto (padding/font-size/estructura propios, como
// organizerNotificationTemplates.js) NO usan este helper — ver el
// comentario en ese archivo.
export function renderSmarticketEmailHeader({ padding = "20px 24px" } = {}) {
    return `            <tr>
              <td style="background-color:#0B1120;padding:${padding};">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
                  Smart<span style="color:#a78bfa;">icket</span>
                </span>
              </td>
            </tr>`;
}
