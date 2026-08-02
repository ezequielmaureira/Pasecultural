const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

// Todo texto que venga del usuario o de la base (nombre del comprador,
// título del evento, lugar, tipo de entrada...) pasa por acá antes de
// interpolarse en el HTML del email — nunca se inyecta crudo.
export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
