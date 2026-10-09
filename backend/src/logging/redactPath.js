// Ruta apta para logs: sin query string y con cualquier segmento largo
// enmascarado. Varios endpoints públicos llevan un bearer token en el path
// (/api/sales/:token/status|pdf|resend-email, invitaciones de scanner) —
// loguear la URL tal cual dejaba credenciales válidas en los logs. Los ids
// técnicos (cuid, 25 caracteres) se conservan para diagnosticar; los tokens
// del proyecto (randomBytes base64url, 32+ caracteres) no.
const MIN_SECRET_SEGMENT_LENGTH = 32;

export function redactPath(originalUrl) {
    const path = String(originalUrl ?? "").split("?")[0];
    return path
        .split("/")
        .map((segment) => (segment.length >= MIN_SECRET_SEGMENT_LENGTH ? "[redacted]" : segment))
        .join("/");
}
