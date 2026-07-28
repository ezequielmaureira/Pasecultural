export function parse(rawValue) {
    const raw = typeof rawValue === "string" ? rawValue.trim() : "";
    const parsed = raw ? new Date(raw) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
        return { error: "Mandame una fecha válida (ej: 2026-08-15)." };
    }
    return { value: parsed.toISOString() };
}

// Reutilizado por los demás inputHandlers de Funciones (fecha suelta dentro
// de un objeto compuesto, rango de fechas, listas).
export function isValidDateString(raw) {
    if (typeof raw !== "string" || !raw.trim()) return false;
    const parsed = new Date(raw);
    return !Number.isNaN(parsed.getTime());
}
