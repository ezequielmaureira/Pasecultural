import test from "node:test";
import assert from "node:assert/strict";
import { geocodeAddress, geocodeLocationIfNeeded } from "../src/services/geocoding.service.js";

// Fase 3J — geocoding.service.js lee GOOGLE_MAPS_SERVER_API_KEY de forma
// LAZY y la cachea en memoria de módulo tras la primera lectura exitosa
// (mismo criterio que whatsapp.service.js#getWhatsappAccessToken). Por eso
// el test de "falta la API key" corre PRIMERO en este archivo, antes de que
// cualquier otro test la configure — una vez cacheada, ya no se vuelve a
// leer process.env en esta misma corrida de node --test.
//
// Ningún test depende de Google real ni de conectividad: se mockea
// globalThis.fetch (mismo patrón que tests/whatsapp.send.test.js).

function mockFetchOnce(handler) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

function geocodeOkPayload(overrides = {}) {
    return {
        status: "OK",
        results: [
            {
                formatted_address: "Sobremonte 123, X5800 Río Cuarto, Córdoba, Argentina",
                place_id: "ChIJ_test_place_id",
                geometry: { location: { lat: -33.1232, lng: -64.3492 } },
                ...overrides,
            },
        ],
    };
}

const VALID_ADDRESS = { address: "Sobremonte 123", city: "Río Cuarto", province: "Córdoba" };

// ==================================================
// 6) API key inexistente → fallback seguro sin romper el flujo. Corre
// PRIMERO a propósito (ver comentario de arriba).
// ==================================================

// `getGoogleMapsServerApiKey` sólo cachea el valor cuando SÍ lo encuentra
// (nunca cachea "ausente") — así que borrar/reponer process.env entre estos
// dos tests y el resto del archivo es seguro, siempre que cada uno la deje
// como la necesita el siguiente. Ambos la reponen en su `finally` para que
// el resto del archivo (que sí la necesita configurada) no se vea afectado
// por el orden real de ejecución de node:test.
test("6) geocodeAddress returns null when GOOGLE_MAPS_SERVER_API_KEY is not configured, without ever calling fetch", async () => {
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;

    let fetchCalled = false;
    const restoreFetch = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restoreFetch();
        process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-google-maps-server-key";
    }

    assert.equal(result, null);
    assert.equal(fetchCalled, false, "sin API key nunca debe intentar la llamada HTTP");
});

test("6b) geocodeLocationIfNeeded also falls back safely when there is no API key: coordinates stay null, googlePlaceId preserved", async () => {
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;

    let result;
    try {
        result = await geocodeLocationIfNeeded({ ...VALID_ADDRESS, latitude: null, longitude: null, googlePlaceId: null });
    } finally {
        process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-google-maps-server-key";
    }

    assert.deepEqual(result, { latitude: null, longitude: null, googlePlaceId: null });
});

// ==================================================
// 1/2) dirección manual (Web o WhatsApp, MISMA función, MISMO shape) sin
// coordenadas → el geocoder devuelve resultado → se guardan lat/lng.
// ==================================================

test("1/2) a manual address with no coordinates gets geocoded and returns real lat/lng — same behavior regardless of channel", async () => {
    let capturedUrl;
    const restore = mockFetchOnce(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, geocodeOkPayload());
    });

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.deepEqual(result, {
        latitude: -33.1232,
        longitude: -64.3492,
        formattedAddress: "Sobremonte 123, X5800 Río Cuarto, Córdoba, Argentina",
        googlePlaceId: "ChIJ_test_place_id",
    });
    // La consulta se arma con address+city+province(+país por default) —
    // Web y WhatsApp arman EXACTAMENTE el mismo shape de entrada
    // (ver inputHandlers/location.js), así que llegan acá de la misma forma.
    assert.ok(capturedUrl.includes(encodeURIComponent("Sobremonte 123, Río Cuarto, Córdoba, Argentina")));
});

test("1/2) geocodeLocationIfNeeded fills latitude/longitude from the geocoder when none were provided", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));

    let result;
    try {
        result = await geocodeLocationIfNeeded({ ...VALID_ADDRESS, latitude: null, longitude: null, googlePlaceId: null });
    } finally {
        restore();
    }

    assert.equal(result.latitude, -33.1232);
    assert.equal(result.longitude, -64.3492);
});

// Defaultea a Argentina cuando no se informa country — nunca inventa ciudad
// ni provincia.
test("builds the query with 'Argentina' as default country when none is provided", async () => {
    let capturedUrl;
    const restore = mockFetchOnce(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, geocodeOkPayload());
    });

    try {
        await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.ok(capturedUrl.includes(encodeURIComponent("Argentina")));
});

test("uses the given country instead of the default when one is provided", async () => {
    let capturedUrl;
    const restore = mockFetchOnce(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, geocodeOkPayload());
    });

    try {
        await geocodeAddress({ ...VALID_ADDRESS, country: "Uruguay" });
    } finally {
        restore();
    }

    assert.ok(capturedUrl.includes(encodeURIComponent("Uruguay")));
    assert.ok(!capturedUrl.includes(encodeURIComponent(", Argentina")));
});

// ==================================================
// 3) ubicación con coordenadas existentes → NO llama al geocoder — nunca se
// pisa un dato mejor (WhatsApp compartido, o picker de Google Maps en Web).
// ==================================================

test("3) a location that already has real coordinates is returned as-is, never calling the geocoder", async () => {
    let fetchCalled = false;
    const restore = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    let result;
    try {
        result = await geocodeLocationIfNeeded({
            latitude: -31.4201,
            longitude: -64.1888,
            address: "Av. Vélez Sarsfield 365",
            city: "Córdoba",
            province: "Córdoba",
            googlePlaceId: "already-had-one",
        });
    } finally {
        restore();
    }

    assert.deepEqual(result, { latitude: -31.4201, longitude: -64.1888, googlePlaceId: "already-had-one" });
    assert.equal(fetchCalled, false, "con coordenadas ya presentes nunca debe llamar al geocoder");
});

// ==================================================
// 4) geocoder sin resultados (ZERO_RESULTS) → el evento sigue con lat/lng null.
// ==================================================

test("4) ZERO_RESULTS from Google leaves latitude/longitude as null, never throws", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, { status: "ZERO_RESULTS", results: [] }));

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});

test("4b) geocodeLocationIfNeeded with a ZERO_RESULTS geocoder keeps coordinates null and preserves googlePlaceId", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, { status: "ZERO_RESULTS", results: [] }));

    let result;
    try {
        result = await geocodeLocationIfNeeded({ ...VALID_ADDRESS, latitude: null, longitude: null, googlePlaceId: null });
    } finally {
        restore();
    }

    assert.deepEqual(result, { latitude: null, longitude: null, googlePlaceId: null });
});

// Otros status de error de Google (no sólo ZERO_RESULTS) también deben
// tratarse como "sin resultado", nunca lanzar.
for (const status of ["OVER_QUERY_LIMIT", "REQUEST_DENIED", "INVALID_REQUEST", "UNKNOWN_ERROR"]) {
    test(`a Google status of "${status}" is treated as no result, never throws`, async () => {
        const restore = mockFetchOnce(async () => jsonResponse(200, { status, results: [] }));

        let result;
        try {
            result = await geocodeAddress(VALID_ADDRESS);
        } finally {
            restore();
        }

        assert.equal(result, null);
    });
}

// ==================================================
// 5) el geocoder lanza/falla (timeout, red, HTTP error) → el evento sigue
// con lat/lng null, nunca revienta la creación/edición del evento.
// ==================================================

test("5) a network failure (fetch throws) never propagates — returns null", async () => {
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});

test("5b) an HTTP error from Google (non-2xx) never propagates — returns null", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(500, { error: "internal" }));

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});

// No se espera el timeout real de 5s (sería lento en CI): se simula
// directamente el mismo tipo de error que produciría un AbortController real
// al vencer — el catch de requestGeocode no distingue por `error.name`, así
// que este es el mismo camino de código que un timeout real dispararía.
test("5c) a timeout (AbortError) never propagates — returns null", async () => {
    const restore = mockFetchOnce(async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
    });

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});

test("5d) an invalid JSON body never propagates — returns null", async () => {
    const restore = mockFetchOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => {
            throw new Error("invalid json");
        },
    }));

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});

// geocodeAddress/geocodeLocationIfNeeded nunca inventan ciudad/provincia:
// si falta cualquiera de los tres campos, ni siquiera se intenta la llamada.
test("never invents address/city/province: missing any of the three skips the geocoder entirely", async () => {
    let fetchCalled = false;
    const restore = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    try {
        assert.equal(await geocodeAddress({ address: "Sobremonte 123", city: "Río Cuarto", province: "" }), null);
        assert.equal(await geocodeAddress({ address: "Sobremonte 123", city: "", province: "Córdoba" }), null);
        assert.equal(await geocodeAddress({ address: "", city: "Río Cuarto", province: "Córdoba" }), null);
        assert.equal(
            (await geocodeLocationIfNeeded({ latitude: null, longitude: null, address: "Sobremonte 123", city: "", province: "Córdoba", googlePlaceId: null })).latitude,
            null
        );
    } finally {
        restore();
    }

    assert.equal(fetchCalled, false);
});

// ==================================================
// 7) la dirección geocodificada conserva address/city/province originales:
// geocodeLocationIfNeeded SÓLO devuelve {latitude, longitude, googlePlaceId}
// — nunca toca ni sobreescribe address/city/province (esos siguen viniendo
// tal cual del organizador, ver event.service.js#buildLocationData).
// ==================================================

test("7) geocodeLocationIfNeeded's result only ever contains latitude/longitude/googlePlaceId — never address/city/province", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));

    let result;
    try {
        result = await geocodeLocationIfNeeded({ ...VALID_ADDRESS, latitude: null, longitude: null, googlePlaceId: null });
    } finally {
        restore();
    }

    assert.deepEqual(Object.keys(result).sort(), ["googlePlaceId", "latitude", "longitude"]);
});

// ==================================================
// 8) googlePlaceId se conserva/guarda si Google lo devuelve.
// ==================================================

test("8) googlePlaceId from Google is used when the location didn't already have one", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload({ place_id: "ChIJ_from_google" })));

    let result;
    try {
        result = await geocodeLocationIfNeeded({ ...VALID_ADDRESS, latitude: null, longitude: null, googlePlaceId: null });
    } finally {
        restore();
    }

    assert.equal(result.googlePlaceId, "ChIJ_from_google");
});

test("8b) an existing googlePlaceId is never overwritten by the geocoded one", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload({ place_id: "ChIJ_from_google" })));

    // Caso defensivo (no debería darse en la práctica: si ya hay
    // coordenadas, ni se llega a llamar al geocoder — ver test 3). Prueba
    // igual la regla "nunca pisar un dato ya presente" a nivel de la
    // función pura, por si en el futuro un caller la usa con lat/lng
    // parciales.
    let result;
    try {
        result = await geocodeLocationIfNeeded({ address: "x", city: "y", province: "z", latitude: null, longitude: null, googlePlaceId: "already-had-one" });
    } finally {
        restore();
    }

    assert.equal(result.googlePlaceId, "already-had-one");
});

test("a result missing usable lat/lng in geometry.location is treated as no result", async () => {
    const restore = mockFetchOnce(async () =>
        jsonResponse(200, { status: "OK", results: [{ formatted_address: "x", place_id: "y", geometry: {} }] })
    );

    let result;
    try {
        result = await geocodeAddress(VALID_ADDRESS);
    } finally {
        restore();
    }

    assert.equal(result, null);
});
