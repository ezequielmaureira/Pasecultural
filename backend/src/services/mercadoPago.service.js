// MP-1 — integración server-to-server con la API OAuth de Mercado Pago.
// Verificado contra la documentación oficial vigente (developers.mercadopago.com,
// secciones "OAuth" y "Referencia API"), nunca contra blogs/tutoriales de
// terceros:
//
//   - Authorization URL: https://auth.mercadopago.com/authorization
//     (client_id, response_type=code, redirect_uri, state, platform_id=mp,
//     scope=offline_access — este último es imprescindible para recibir
//     un refresh_token; sin él, la documentación indica que el flujo de
//     renovación no puede usarse).
//   - Intercambio del code: POST https://api.mercadopago.com/oauth/token,
//     Content-Type: application/json, {client_id, client_secret,
//     grant_type:"authorization_code", code, redirect_uri}.
//   - Renovación: mismo endpoint, {client_id, client_secret,
//     grant_type:"refresh_token", refresh_token}.
//   - Respuesta (ambos casos): access_token, token_type ("bearer", único
//     valor soportado), expires_in (segundos; 15552000 = 180 días por
//     default), scope, user_id, refresh_token, public_key, live_mode.
//   - El authorization code vence a los 10 minutos. El refresh_token ROTA
//     en cada renovación (la respuesta trae uno nuevo que invalida al
//     anterior) — quien llama a refreshMercadoPagoAccessToken es
//     responsable de persistir el nuevo refresh_token, nunca reusar el
//     viejo.
//
// PKCE existe como capa opcional adicional (no obligatoria) — no se
// implementa en MP-1: la protección CSRF real de esta integración es el
// `state` de un solo uso (ver mercadoPagoOAuthState.service.js), que sí es
// responsabilidad exclusiva de la aplicación según la propia documentación
// de Mercado Pago (Mercado Pago no lo valida de ninguna forma).
//
// Mismo criterio LAZY de variables de entorno que whatsapp.service.js
// (getWhatsappAccessToken, etc.): recién se exigen en el primer uso real,
// nunca al arrancar el servidor.

const AUTHORIZATION_URL = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
const OAUTH_TIMEOUT_MS = 10000;

// Revisión posterior a la entrega de MP-1: un timeout/error de red/5xx de
// Mercado Pago contra /oauth/token es AMBIGUO (no sabemos si Mercado Pago
// llegó a consumir el code antes de que la respuesta se perdiera), así que
// vale la pena un único reintento antes de darlo por perdido — sin tocar
// en absoluto el consumo del `state` (ver mercadoPagoConnection.service.js):
// el state se sigue reclamando UNA sola vez, ANTES de esta llamada, y esta
// llamada entera (con su reintento incluido) ocurre DENTRO de esa única
// invocación del callback. Un rechazo explícito de Mercado Pago (4xx: code
// inválido/expirado/ya usado) o una respuesta 2xx incompleta (el code ya
// fue consumido, sólo que la respuesta no trae lo que necesitamos) NUNCA
// se reintentan: repetir el mismo code ahí sólo puede fallar de nuevo.
const TOKEN_EXCHANGE_MAX_ATTEMPTS = 2;
const TOKEN_EXCHANGE_RETRY_DELAY_MS = 300;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTokenEndpointFailure(result) {
    if (result.success) return false;
    if (result.error === "TIMEOUT" || result.error === "NETWORK_ERROR") return true;
    // 5xx = falla del lado de Mercado Pago antes de resolver el request
    // (no una decisión sobre el code). 429 (local_rate_limited, documentado
    // en la referencia oficial de /oauth/token junto a invalid_grant/
    // invalid_request/invalid_client) tampoco es un rechazo del code — es
    // un límite de tasa que frenó el request ANTES de evaluarlo, así que
    // también se reintenta. El resto de los 4xx (incluido 400 invalid_grant,
    // el código documentado para "inválido, expirado, revocado o ya usado")
    // sí es una decisión explícita de Mercado Pago sobre ESE code — nunca
    // se reintenta.
    if (typeof result.httpStatus !== "number") return false;
    return result.httpStatus >= 500 || result.httpStatus === 429;
}

let cachedClientId;
export function getMercadoPagoClientId() {
    if (cachedClientId) return cachedClientId;
    const value = process.env.MERCADOPAGO_CLIENT_ID;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno MERCADOPAGO_CLIENT_ID.");
    }
    cachedClientId = value.trim();
    return cachedClientId;
}

let cachedClientSecret;
function getMercadoPagoClientSecret() {
    if (cachedClientSecret) return cachedClientSecret;
    const value = process.env.MERCADOPAGO_CLIENT_SECRET;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno MERCADOPAGO_CLIENT_SECRET.");
    }
    cachedClientSecret = value.trim();
    return cachedClientSecret;
}

let cachedRedirectUri;
export function getMercadoPagoRedirectUri() {
    if (cachedRedirectUri) return cachedRedirectUri;
    const value = process.env.MERCADOPAGO_REDIRECT_URI;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno MERCADOPAGO_REDIRECT_URI.");
    }
    cachedRedirectUri = value.trim();
    return cachedRedirectUri;
}

// Arma la authorization URL completa — nunca hace ningún request, es pura
// construcción de string a partir de config + el `state` ya generado por
// el caller (ver mercadoPagoConnection.service.js). `scope=offline_access`
// es lo que garantiza que la respuesta del intercambio incluya
// refresh_token (necesario para poder renovar en MP-2, sin tener que
// rehacer todo el flujo de autorización).
export function buildMercadoPagoAuthorizationUrl(state) {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set("client_id", getMercadoPagoClientId());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("redirect_uri", getMercadoPagoRedirectUri());
    url.searchParams.set("scope", "offline_access");
    url.searchParams.set("state", state);
    return url.toString();
}

async function postToTokenEndpointOnce(body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        // Nunca se loguea acá — el caller decide qué loguear, y NUNCA
        // client_secret/tokens (ver mercadoPagoConnection.service.js).
        return { success: false, error: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
    } finally {
        clearTimeout(timeoutId);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        // Mercado Pago devuelve {error, message, status} en el body de un
        // rechazo — se conserva sólo el mensaje/código, nunca el body
        // completo (podría repetir datos sensibles del request original).
        return {
            success: false,
            error: payload?.message ?? payload?.error ?? `HTTP_${response.status}`,
            httpStatus: response.status,
        };
    }

    if (!payload?.access_token || !payload?.refresh_token) {
        // Defensivo — una respuesta 2xx sin ambos tokens no es utilizable
        // para esta integración (necesitamos refresh_token siempre, ver el
        // comentario de scope=offline_access más arriba); nunca se persiste
        // una conexión a medias. Esto ya es una respuesta 2xx de Mercado
        // Pago: el code fue consumido, reintentar no puede ayudar.
        return { success: false, error: "INCOMPLETE_TOKEN_RESPONSE" };
    }

    return {
        success: true,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        mercadoPagoUserId: String(payload.user_id ?? ""),
        publicKey: payload.public_key ?? null,
        liveMode: Boolean(payload.live_mode),
        scope: payload.scope ?? null,
        expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : null,
    };
}

async function postToTokenEndpoint(body) {
    let result;
    for (let attempt = 1; attempt <= TOKEN_EXCHANGE_MAX_ATTEMPTS; attempt++) {
        result = await postToTokenEndpointOnce(body);
        if (attempt === TOKEN_EXCHANGE_MAX_ATTEMPTS || !isTransientTokenEndpointFailure(result)) {
            break;
        }
        await sleep(TOKEN_EXCHANGE_RETRY_DELAY_MS);
    }
    // httpStatus era sólo un detalle interno para decidir si reintentar —
    // nunca formó parte del contrato público de este módulo.
    if (result && !result.success) delete result.httpStatus;
    return result;
}

// Intercambio server-to-server del authorization `code` recibido en el
// callback — nunca se llama desde el navegador. redirect_uri viaja de
// nuevo acá porque la documentación de Mercado Pago lo exige igual al que
// se usó para generar la authorization URL.
export async function exchangeMercadoPagoAuthorizationCode(code) {
    return postToTokenEndpoint({
        client_id: getMercadoPagoClientId(),
        client_secret: getMercadoPagoClientSecret(),
        grant_type: "authorization_code",
        code,
        redirect_uri: getMercadoPagoRedirectUri(),
    });
}

// Renovación — MP-1 no la programa ni la llama automáticamente (sin cron,
// ver el informe de entrega), pero queda implementada y testeada de forma
// aislada para que MP-2 pueda usarla sin rehacer OAuth. El refresh_token
// devuelto SIEMPRE reemplaza al anterior (rota en cada uso, confirmado
// contra la documentación oficial) — el caller debe persistir ambos
// valores nuevos atómicamente.
export async function refreshMercadoPagoAccessToken(refreshToken) {
    return postToTokenEndpoint({
        client_id: getMercadoPagoClientId(),
        client_secret: getMercadoPagoClientSecret(),
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
}
