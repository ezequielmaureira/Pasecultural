import test from "node:test";
import assert from "node:assert/strict";
import {
    getMercadoPagoClientId,
    getMercadoPagoRedirectUri,
    buildMercadoPagoAuthorizationUrl,
    exchangeMercadoPagoAuthorizationCode,
    refreshMercadoPagoAccessToken,
} from "../src/services/mercadoPago.service.js";

// mercadoPago.service.js lee MERCADOPAGO_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI
// de forma LAZY y los cachea tras la primera lectura exitosa (mismo
// criterio que whatsapp.service.js#getWhatsappAccessToken) — por eso el
// test de "variable faltante" corre PRIMERO, antes de que nada las cachee.

function mockFetchOnce(handler) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// A) falta configuración -> falla explícito, antes de tocar la red. Corre
// PRIMERO a propósito (antes de que cualquier lectura exitosa cachee un
// valor, ver el comentario de arriba) — pero restaura la variable
// inmediatamente después: getMercadoPagoClientId/getMercadoPagoRedirectUri
// cachean en memoria de módulo tras la primera lectura EXITOSA, así que
// borrarlas y no volver a asignarlas dejaría a TODOS los tests siguientes
// de este archivo sin configuración.
test("getMercadoPagoClientId throws a clear error when MERCADOPAGO_CLIENT_ID is not configured yet", () => {
    delete process.env.MERCADOPAGO_CLIENT_ID;
    assert.throws(() => getMercadoPagoClientId(), /Falta configurar la variable de entorno MERCADOPAGO_CLIENT_ID/);
    process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
});

test("getMercadoPagoRedirectUri throws a clear error when MERCADOPAGO_REDIRECT_URI is not configured yet", () => {
    delete process.env.MERCADOPAGO_REDIRECT_URI;
    assert.throws(() => getMercadoPagoRedirectUri(), /Falta configurar la variable de entorno MERCADOPAGO_REDIRECT_URI/);
    process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
});

process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";

// B) authorization URL exacta, con scope=offline_access (imprescindible
// para poder recibir refresh_token, ver mercadoPago.service.js).
test("buildMercadoPagoAuthorizationUrl builds the exact official authorization URL with offline_access scope", () => {
    const url = new URL(buildMercadoPagoAuthorizationUrl("STATE_VALUE_123"));

    assert.equal(`${url.origin}${url.pathname}`, "https://auth.mercadopago.com/authorization");
    assert.equal(url.searchParams.get("client_id"), "test-client-id");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("platform_id"), "mp");
    assert.equal(url.searchParams.get("redirect_uri"), "https://api.pasecultural.test/api/mercadopago/oauth/callback");
    assert.equal(url.searchParams.get("scope"), "offline_access");
    assert.equal(url.searchParams.get("state"), "STATE_VALUE_123");
});

// C) intercambio del code: URL/headers/body correctos.
test("exchangeMercadoPagoAuthorizationCode posts the correct request to the official token endpoint", async () => {
    let capturedUrl;
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return jsonResponse(200, {
            access_token: "APP_USR-token",
            refresh_token: "TG-refresh",
            user_id: 123456789,
            public_key: "APP_USR-pubkey",
            live_mode: true,
            scope: "offline_access read write",
            token_type: "bearer",
            expires_in: 15552000,
        });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("AUTH_CODE_ABC");
    } finally {
        restore();
    }

    assert.equal(capturedUrl, "https://api.mercadopago.com/oauth/token");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(capturedOptions.body), {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        grant_type: "authorization_code",
        code: "AUTH_CODE_ABC",
        redirect_uri: "https://api.pasecultural.test/api/mercadopago/oauth/callback",
    });

    assert.deepEqual(result, {
        success: true,
        accessToken: "APP_USR-token",
        refreshToken: "TG-refresh",
        mercadoPagoUserId: "123456789",
        publicKey: "APP_USR-pubkey",
        liveMode: true,
        scope: "offline_access read write",
        expiresInSeconds: 15552000,
    });
});

// D) Mercado Pago rechaza -> error controlado, nunca lanza, nunca expone el body crudo.
test("exchangeMercadoPagoAuthorizationCode returns a controlled failure when Mercado Pago rejects the code", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(400, { message: "invalid_grant", error: "invalid_grant" }));

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("BAD_CODE");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "invalid_grant");
    assert.equal(result.accessToken, undefined);
});

// E) respuesta 2xx pero incompleta (sin refresh_token) -> nunca se toma como éxito.
test("exchangeMercadoPagoAuthorizationCode treats a 2xx response missing refresh_token as a failure", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, { access_token: "only-access-token" }));

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "INCOMPLETE_TOKEN_RESPONSE");
});

// F) error de red -> error controlado.
test("exchangeMercadoPagoAuthorizationCode returns a controlled error on a network failure", async () => {
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "NETWORK_ERROR");
});

// F.1) revisión post-entrega — un error transitorio (timeout/red/5xx) se
// reintenta UNA vez dentro de la misma llamada, y si el reintento
// funciona, el caller nunca se entera de que hubo un primer intento
// fallido.
test("exchangeMercadoPagoAuthorizationCode retries once after a network error and succeeds if the retry works", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return jsonResponse(200, { access_token: "a", refresh_token: "b", user_id: 1, expires_in: 100 });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 2, "debe haber reintentado exactamente una vez");
    assert.equal(result.success, true);
    assert.equal(result.accessToken, "a");
});

// F.2) un 502/503 de Mercado Pago (su propio lado, no una decisión sobre
// el code) también se reintenta.
test("exchangeMercadoPagoAuthorizationCode retries once after a 502 from Mercado Pago", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(502, { message: "bad_gateway" });
        return jsonResponse(200, { access_token: "a", refresh_token: "b", user_id: 1, expires_in: 100 });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 2);
    assert.equal(result.success, true);
});

// F.2.b) 429 (local_rate_limited, documentado junto a invalid_grant en la
// referencia oficial de /oauth/token) tampoco es un rechazo del code —
// también se reintenta.
test("exchangeMercadoPagoAuthorizationCode retries once after a 429 (local_rate_limited) from Mercado Pago", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(429, { error: "local_rate_limited", message: "too many requests" });
        return jsonResponse(200, { access_token: "a", refresh_token: "b", user_id: 1, expires_in: 100 });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 2);
    assert.equal(result.success, true);
});

// F.3) si el reintento TAMBIÉN falla, se agota en 2 intentos totales —
// nunca reintenta indefinidamente — y el resultado nunca expone httpStatus
// (era un detalle interno para decidir si reintentar).
test("exchangeMercadoPagoAuthorizationCode gives up after a single retry, never expones httpStatus", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        return jsonResponse(503, { message: "service_unavailable" });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 2, "1 intento inicial + 1 reintento, nunca más");
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, undefined, "httpStatus nunca debe formar parte del resultado público");
});

// F.4) un rechazo explícito de Mercado Pago (4xx: code inválido/expirado/
// ya usado) NUNCA se reintenta — repetir el mismo code sólo puede fallar
// de nuevo, y cada intento extra es superficie innecesaria.
test("exchangeMercadoPagoAuthorizationCode never retries an explicit 4xx rejection from Mercado Pago", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        return jsonResponse(400, { message: "invalid_grant" });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("BAD_CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 1, "un 4xx es una decisión explícita de Mercado Pago, no algo transitorio");
    assert.equal(result.success, false);
    assert.equal(result.error, "invalid_grant");
});

// F.5) una respuesta 2xx incompleta tampoco se reintenta — el code ya fue
// consumido por Mercado Pago aunque la respuesta no traiga lo necesario.
test("exchangeMercadoPagoAuthorizationCode never retries an incomplete 2xx response", async () => {
    let calls = 0;
    const restore = mockFetchOnce(async () => {
        calls += 1;
        return jsonResponse(200, { access_token: "only-access-token" });
    });

    let result;
    try {
        result = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restore();
    }

    assert.equal(calls, 1, "una 2xx ya significa que Mercado Pago consumió el code");
    assert.equal(result.success, false);
    assert.equal(result.error, "INCOMPLETE_TOKEN_RESPONSE");
});

// G) renovación: grant_type correcto, nunca manda el authorization code.
test("refreshMercadoPagoAccessToken posts grant_type=refresh_token with the stored refresh token", async () => {
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedOptions = options;
        return jsonResponse(200, {
            access_token: "APP_USR-new-token",
            refresh_token: "TG-new-refresh",
            user_id: 123456789,
            public_key: "APP_USR-pubkey",
            live_mode: true,
            scope: "offline_access",
            expires_in: 15552000,
        });
    });

    let result;
    try {
        result = await refreshMercadoPagoAccessToken("TG-old-refresh");
    } finally {
        restore();
    }

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.grant_type, "refresh_token");
    assert.equal(body.refresh_token, "TG-old-refresh");
    assert.equal(body.code, undefined, "el refresh nunca debe mandar un authorization code");
    assert.equal(result.accessToken, "APP_USR-new-token");
    assert.equal(result.refreshToken, "TG-new-refresh", "el refresh_token rota — el caller debe persistir el NUEVO, nunca reusar el viejo");
});

// H) nunca se filtra client_secret en ningún resultado devuelto al caller.
test("no successful or failed exchange/refresh result ever leaks client_secret", async () => {
    const restoreOk = mockFetchOnce(async () =>
        jsonResponse(200, { access_token: "a", refresh_token: "b", user_id: 1, expires_in: 1 })
    );
    let okResult;
    try {
        okResult = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restoreOk();
    }
    assert.ok(!JSON.stringify(okResult).includes("test-client-secret"));

    const restoreFail = mockFetchOnce(async () => jsonResponse(401, { message: "unauthorized" }));
    let failResult;
    try {
        failResult = await exchangeMercadoPagoAuthorizationCode("CODE");
    } finally {
        restoreFail();
    }
    assert.ok(!JSON.stringify(failResult).includes("test-client-secret"));
});
