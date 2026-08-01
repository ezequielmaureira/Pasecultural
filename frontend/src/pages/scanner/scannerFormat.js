// Formato compacto ("Sáb 24 ago", "18:00") — el mismo estilo que ya se
// aprobó en los mockups de la Fase 0. Deliberadamente más corto que el
// formato de Mis Entradas: acá se lee de reojo en una lista, no en el
// detalle de una entrada.
export function formatFunctionDate(dateValue) {
    if (!dateValue) return "";
    return new Date(dateValue).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" });
}

export function formatFunctionTime(dateValue) {
    if (!dateValue) return "";
    // hour12: false a propósito — el motor de ICU de Node/algunos navegadores
    // devuelve "06:00 p. m." para es-AR sin esto, y los mockups de la Fase 0
    // usan formato 24hs ("18:00", "21:00").
    return new Date(dateValue).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function functionLabel(fn) {
    return `Función ${formatFunctionTime(fn.date)}`;
}
