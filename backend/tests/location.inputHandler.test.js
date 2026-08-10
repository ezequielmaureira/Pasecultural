import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/conversation/inputHandlers/location.js";

// Bug fix (ubicación por WhatsApp Location) — inputHandlers/location.js
// (compartido por Web y WhatsApp) ahora acepta DOS caminos válidos:
// dirección escrita completa (address+city+province, el camino Web de
// siempre, con o sin coordenadas) O coordenadas reales (el camino WhatsApp
// nuevo, sin ciudad/provincia). Nunca se inventa una ciudad/provincia
// cuando no vienen — quedan `null`.

// ==================================================
// Camino Web — SIN cambios de comportamiento para lo que ya funcionaba.
// ==================================================

test("a full written address (Web, con o sin mapa) is still accepted exactly as before", () => {
    const result = parse({ address: "Av. Colón 1234", city: "Córdoba", province: "Córdoba", venueName: "Teatro X", latitude: -31.4, longitude: -64.18, googlePlaceId: "place123" });
    assert.deepEqual(result, {
        value: { address: "Av. Colón 1234", city: "Córdoba", province: "Córdoba", venueName: "Teatro X", latitude: -31.4, longitude: -64.18, googlePlaceId: "place123" },
    });
});

test("a full written address WITHOUT coordinates (Web manual mode, sin mapa) is still accepted exactly as before", () => {
    const result = parse({ address: "Av. Colón 1234", city: "Córdoba", province: "Córdoba" });
    assert.equal(result.error, undefined);
    assert.equal(result.value.address, "Av. Colón 1234");
    assert.equal(result.value.latitude, null);
    assert.equal(result.value.longitude, null);
});

test("a written address missing city or province is still rejected exactly as before (when there are no coordinates either)", () => {
    assert.equal(parse({ address: "Av. Colón 1234", city: "", province: "Córdoba" }).error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
    assert.equal(parse({ address: "Av. Colón 1234", city: "Córdoba", province: "" }).error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
    assert.equal(parse({}).error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
});

// ==================================================
// Camino WhatsApp — NUEVO: coordenadas solas, sin ciudad/provincia.
// ==================================================

test("coordinates alone (no written address), the WhatsApp path, are now accepted", () => {
    const result = parse({ latitude: -31.4201, longitude: -64.1888, venueName: "Teatro del Libertador", address: "Av. Vélez Sarsfield 365" });
    assert.deepEqual(result, {
        value: {
            address: "Av. Vélez Sarsfield 365",
            city: null,
            province: null,
            venueName: "Teatro del Libertador",
            latitude: -31.4201,
            longitude: -64.1888,
            googlePlaceId: null,
        },
    });
});

test("coordinates alone with no name/address at all (a live pin, not a searched place) are still accepted", () => {
    const result = parse({ latitude: -34.603722, longitude: -58.381592 });
    assert.deepEqual(result, {
        value: { address: null, city: null, province: null, venueName: null, latitude: -34.603722, longitude: -58.381592, googlePlaceId: null },
    });
});

test("never invents a city or province when WhatsApp doesn't provide one — they stay null, never a placeholder", () => {
    const result = parse({ latitude: -31.4, longitude: -64.18 });
    assert.equal(result.value.city, null);
    assert.equal(result.value.province, null);
});

// ==================================================
// Ni dirección ni coordenadas -> sigue siendo inválido (nunca se relaja
// completamente la validación).
// ==================================================

test("neither a written address nor real coordinates is rejected", () => {
    assert.equal(parse({ venueName: "Algún lugar" }).error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
    assert.equal(parse(null).error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
});

// ==================================================
// El motor NUNCA acepta texto libre como si fuera una ubicación — un
// string (lo que manda WhatsApp para cualquier mensaje de texto) no es un
// objeto, así que cae directo al mismo camino "sin nada válido".
// ==================================================

test("a plain string (free text, never a location) is always rejected, never geocoded or guessed", () => {
    assert.equal(parse("San Martín 123").error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
});

test("invalid/NaN coordinates are treated as no coordinates at all", () => {
    const result = parse({ latitude: "not-a-number", longitude: "also-not-a-number" });
    assert.equal(result.error, "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación.");
});
