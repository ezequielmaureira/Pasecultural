// Fest Pass (draft.quickPassEnabled) exige precio > 0 — un Fest Pass no
// puede terminar siendo gratuito por accidente (ver EVENT_CREATION_TYPE en
// steps/definitions.js, que ya deja el draft como TICKETED/PAID). Evento
// tradicional mantiene EXACTAMENTE la regla de siempre (>= 0): esto nunca
// se endurece para él. El motor (EventCreationEngine#handleInput) ya pasa
// `draft` como segundo argumento a todo handler; el flujo compacto de
// WhatsApp ("General, 8000", ver tryHandleTicketComboSubflow) también
// termina llamando al step TICKET_PRICE real, así que llega por el mismo
// camino sin necesitar ninguna validación duplicada en el controller.
// Exportado (no sólo literal inline) para que whatsapp.controller.js
// (tryHandleTicketComboSubflow) pueda distinguir ESTE error puntual de
// cualquier otro error defensivo/inesperado del motor en ese mismo punto,
// sin adivinar por texto libre ni duplicar la regla de negocio.
export const FEST_PASS_PRICE_REQUIRED_ERROR = "El Fest Pass necesita un precio mayor a 0.";

export function parse(rawValue, { draft } = {}) {
    const n = Number(rawValue);
    if (Number.isNaN(n) || n < 0) {
        return { error: "Necesito un precio válido (0 o más)." };
    }
    if (draft?.quickPassEnabled && n <= 0) {
        return { error: FEST_PASS_PRICE_REQUIRED_ERROR };
    }
    return { value: n };
}
