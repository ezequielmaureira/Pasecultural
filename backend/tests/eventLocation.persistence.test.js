import test from "node:test";
import assert from "node:assert/strict";
import { parse as parseLocation } from "../src/conversation/inputHandlers/location.js";
import { buildLocationInput } from "../src/conversation/EventServicePort.js";
import { buildLocationData } from "../src/services/event.service.js";

// Fase 3J (consolidación) — a diferencia de tests/geocoding.service.test.js
// (que prueba geocoding.service.js AISLADO), este archivo prueba la cadena
// REAL completa, con las funciones reales de cada capa (nunca
// reimplementadas ni aproximadas en el test):
//
//   valor crudo que manda Web o WhatsApp (mismo shape para ambos canales,
//   ver inputHandlers/location.js)
//     -> inputHandlers/location.js#parse (validación/normalización real,
//        compartida por Web y WhatsApp)
//     -> EventServicePort.js#buildLocationInput (mapeo real al shape que
//        espera event.service.js, compartido por Web-conversacional y
//        WhatsApp — ambos pasan por EventCreationEngine/EventServicePort.commit)
//     -> event.service.js#buildLocationData (shape final que recibiría
//        Prisma — acá vive la geocodificación de Fase 3J)
//
// `buildLocationInput`/`buildLocationData` se exportaron ÚNICAMENTE para
// este propósito (ver comentarios en sus archivos): son funciones puras o
// cuya única I/O real (geocodeLocationIfNeeded -> fetch) ya es mockeable
// limpiamente — nunca se llegó a necesitar mockear Prisma ni el módulo ES
// completo (mock.module() no está disponible en este runtime de node:test).
// Nunca se toca Prisma real ni Google real: sólo se mockea globalThis.fetch
// (mismo patrón que tests/whatsapp.send.test.js y
// tests/geocoding.service.test.js).

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

// La API key se configura una sola vez para todo el archivo: ningún test de
// acá prueba el caso "sin API key" (ya cubierto exhaustivamente en
// geocoding.service.test.js) — acá el foco es la cadena de integración.
process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-google-maps-server-key";

// Corre la cadena real completa: parse -> buildLocationInput -> buildLocationData.
async function persistLocation(rawValue) {
    const parsed = parseLocation(rawValue);
    assert.ok(!parsed.error, `parse() no debería rechazar este valor: ${parsed.error}`);
    const engineInput = buildLocationInput(parsed.value);
    return buildLocationData(engineInput);
}

// ==================================================
// Shapes REALES tal cual las arma cada canal (verificado por auditoría de
// código, sin inventar ningún campo):
//   - Web manual (LocationAnswer.jsx#toEngineLocation, con ManualLocationForm
//     — createEmptyLocation deja latitude/longitude en null, ver locationUtils.js).
//   - WhatsApp manual (whatsapp.controller.js#tryHandleLocationSubflow,
//     rama AWAITING_PROVINCE).
//   - WhatsApp compartida con coordenadas (buildLocationInputFromWhatsapp).
//   - Web con LocationPicker (Google Places Autocomplete, con coordenadas
//     reales y googlePlaceId).
// ==================================================

const WEB_MANUAL_VALUE = {
    address: "Sobremonte 123",
    city: "Río Cuarto",
    province: "Córdoba",
    latitude: null,
    longitude: null,
    venueName: null,
    googlePlaceId: null,
};

const WHATSAPP_MANUAL_VALUE = {
    address: "Sobremonte 123",
    city: "Río Cuarto",
    province: "Córdoba",
    venueName: null,
    latitude: null,
    longitude: null,
    googlePlaceId: null,
};

const WHATSAPP_SHARED_VALUE = {
    latitude: -33.1232,
    longitude: -64.3492,
    venueName: "Teatro del Libertador",
    address: "Av. Vélez Sarsfield 365",
    // WhatsApp nunca entrega city/province por separado (ver
    // buildLocationInputFromWhatsapp) — quedan ausentes acá a propósito.
};

const WEB_PICKER_VALUE = {
    address: "Av. Vélez Sarsfield 365",
    city: "Córdoba",
    province: "Córdoba",
    latitude: -31.4201,
    longitude: -64.1888,
    venueName: "Teatro del Libertador",
    googlePlaceId: "ChIJ_from_places_autocomplete",
};

// ==================================================
// 1) Web manual sin coordenadas + geocoder exitoso -> objeto final con lat/lng.
// ==================================================

test("1) Web manual location without coordinates + successful geocoder -> the final persisted object has real lat/lng", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));

    let data;
    try {
        data = await persistLocation(WEB_MANUAL_VALUE);
    } finally {
        restore();
    }

    assert.equal(data.latitude, -33.1232);
    assert.equal(data.longitude, -64.3492);
    assert.equal(data.address, "Sobremonte 123");
    assert.equal(data.city, "Río Cuarto");
    assert.equal(data.province, "Córdoba");
    assert.equal(data.venue, data.venueName, "el campo legacy `venue` sigue sincronizado con venueName");
});

// ==================================================
// 2) WhatsApp manual sin coordenadas + geocoder exitoso -> mismo comportamiento.
// ==================================================

test("2) WhatsApp manual location without coordinates + successful geocoder -> the final persisted object has real lat/lng", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));

    let data;
    try {
        data = await persistLocation(WHATSAPP_MANUAL_VALUE);
    } finally {
        restore();
    }

    assert.equal(data.latitude, -33.1232);
    assert.equal(data.longitude, -64.3492);
    assert.equal(data.address, "Sobremonte 123");
    assert.equal(data.city, "Río Cuarto");
    assert.equal(data.province, "Córdoba");
});

// ==================================================
// 3) Web manual y WhatsApp manual, con la misma dirección, producen un
// resultado de persistencia EQUIVALENTE — misma cadena real, mismo shape de
// entrada por diseño (inputHandlers/location.js es el único punto de
// validación para los dos canales).
// ==================================================

test("3) Web manual and WhatsApp manual with the same address produce an equivalent persisted object", async () => {
    const restoreWeb = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));
    let webData;
    try {
        webData = await persistLocation(WEB_MANUAL_VALUE);
    } finally {
        restoreWeb();
    }

    const restoreWhatsapp = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload()));
    let whatsappData;
    try {
        whatsappData = await persistLocation(WHATSAPP_MANUAL_VALUE);
    } finally {
        restoreWhatsapp();
    }

    assert.deepEqual(webData, whatsappData);
});

// ==================================================
// 4) WhatsApp compartida con coordenadas -> NO geocodifica, conserva
// EXACTAMENTE las coordenadas recibidas.
// ==================================================

test("4) a WhatsApp shared location with real coordinates never calls the geocoder and preserves lat/lng exactly", async () => {
    let fetchCalled = false;
    const restore = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    let data;
    try {
        data = await persistLocation(WHATSAPP_SHARED_VALUE);
    } finally {
        restore();
    }

    assert.equal(fetchCalled, false, "con coordenadas ya presentes, la cadena real nunca debe llamar al geocoder");
    assert.equal(data.latitude, -33.1232);
    assert.equal(data.longitude, -64.3492);
    assert.equal(data.address, "Av. Vélez Sarsfield 365");
    assert.equal(data.venueName, "Teatro del Libertador");
    // WhatsApp nunca entrega ciudad/provincia — la cadena real tampoco las inventa.
    assert.equal(data.city, null);
    assert.equal(data.province, null);
});

// ==================================================
// 5) Web con coordenadas reales del LocationPicker -> NO geocodifica.
// ==================================================

test("5) a Web location with real coordinates from the LocationPicker never calls the geocoder", async () => {
    let fetchCalled = false;
    const restore = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    let data;
    try {
        data = await persistLocation(WEB_PICKER_VALUE);
    } finally {
        restore();
    }

    assert.equal(fetchCalled, false);
    assert.equal(data.latitude, -31.4201);
    assert.equal(data.longitude, -64.1888);
    // El googlePlaceId que ya traía el picker de Google Maps nunca se pisa.
    assert.equal(data.googlePlaceId, "ChIJ_from_places_autocomplete");
});

// ==================================================
// 6/7) el geocoder falla (o no devuelve resultados) -> el objeto final
// conserva address/city/province tal cual, y lat/lng quedan en null — nunca
// se inventa ninguno de los cinco campos.
// ==================================================

test("6/7) when the geocoder fails (network error), the final object keeps address/city/province and lat/lng stay null — nothing is invented", async () => {
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let data;
    try {
        data = await persistLocation(WEB_MANUAL_VALUE);
    } finally {
        restore();
    }

    assert.equal(data.latitude, null);
    assert.equal(data.longitude, null);
    assert.equal(data.address, "Sobremonte 123");
    assert.equal(data.city, "Río Cuarto");
    assert.equal(data.province, "Córdoba");
});

test("6/7) when the geocoder returns ZERO_RESULTS, the final object keeps address/city/province and lat/lng stay null", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, { status: "ZERO_RESULTS", results: [] }));

    let data;
    try {
        data = await persistLocation(WHATSAPP_MANUAL_VALUE);
    } finally {
        restore();
    }

    assert.equal(data.latitude, null);
    assert.equal(data.longitude, null);
    assert.equal(data.address, "Sobremonte 123");
    assert.equal(data.city, "Río Cuarto");
    assert.equal(data.province, "Córdoba");
});

// ==================================================
// 8) googlePlaceId de Google llega al objeto final persistible cuando
// corresponde (no había ninguno antes, y el geocoder sí devuelve uno).
// ==================================================

test("8) googlePlaceId returned by the geocoder reaches the final persisted object when there wasn't one already", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(200, geocodeOkPayload({ place_id: "ChIJ_from_google_geocoding" })));

    let data;
    try {
        data = await persistLocation(WEB_MANUAL_VALUE);
    } finally {
        restore();
    }

    assert.equal(data.googlePlaceId, "ChIJ_from_google_geocoding");
});

test("creating an event without any location at all never throws and never fabricates one (buildLocationData({}))", async () => {
    let fetchCalled = false;
    const restore = mockFetchOnce(async () => {
        fetchCalled = true;
        return jsonResponse(200, geocodeOkPayload());
    });

    let data;
    try {
        data = await buildLocationData(undefined);
    } finally {
        restore();
    }

    assert.deepEqual(data, {});
    assert.equal(fetchCalled, false);
});
