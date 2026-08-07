import { isValidCalendarDateString, normalizeCalendarDateString } from "../../utils/calendarDate.js";

// Una fecha de calendario ("YYYY-MM-DD") nunca es un instante — se valida y
// normaliza sin pasar por `new Date(string)` (ver utils/calendarDate.js).
// Antes esta función devolvía `.toISOString()`, fabricando un timestamp
// falso a medianoche UTC donde sólo correspondía guardar un día.
export function parse(rawValue) {
    const normalized = normalizeCalendarDateString(rawValue);
    if (!normalized) {
        return { error: "Mandame una fecha válida (ej: 2026-08-15)." };
    }
    return { value: normalized };
}

// Reutilizado por los demás inputHandlers de Funciones (fecha suelta dentro
// de un objeto compuesto, rango de fechas, listas).
export function isValidDateString(raw) {
    return isValidCalendarDateString(raw);
}
