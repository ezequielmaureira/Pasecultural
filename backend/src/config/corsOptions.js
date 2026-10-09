// CORS — lista de orígenes permitidos desde CORS_ALLOWED_ORIGINS (separados
// por coma, ej. "https://www.smarticket.com.ar,https://smarticket.com.ar").
// Sin la variable, se mantiene el comportamiento histórico (cualquier
// origen) para no romper producción con un deploy: restringirlo es un
// cambio de configuración explícito. La autenticación es por Bearer token
// (Clerk/JWT de scanner), nunca por cookies, así que un origen abierto no
// expone sesiones — la lista es defensa en profundidad.
// Requests sin Origin (webhooks de Mercado Pago/WhatsApp, curl, health
// checks) nunca se bloquean: CORS sólo aplica a navegadores.
export function buildCorsOptions(env = process.env) {
    const allowed = String(env.CORS_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean);
    if (allowed.length === 0) return {};
    const allowedSet = new Set(allowed);
    return {
        origin(origin, callback) {
            callback(null, !origin || allowedSet.has(origin));
        },
    };
}
