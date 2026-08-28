// Premium — Fase 2A. Validación PURA (nunca toca la base, nunca lanza) del
// color de marca de una futura página pública Premium — ver el informe de
// auditoría, sección "branding". Único formato aceptado: "#RRGGBB" exacto
// (6 dígitos hexadecimales, con "#"). Deliberadamente NO acepta ninguna
// otra sintaxis CSS (nombres de color, "#RGB" corto, rgb()/rgba(), var(),
// url(), gradientes, ni ninguna otra función CSS): un valor validado acá
// nunca puede convertirse en CSS/HTML arbitrario en la página que lo
// consuma más adelante. Sin consumidor todavía en esta ronda (el endpoint
// que lo usaría, PATCH /me/branding, queda para una fase posterior — ver
// el informe de entrega).
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function isValidHexColor(value) {
    return typeof value === "string" && HEX_COLOR_REGEX.test(value);
}
