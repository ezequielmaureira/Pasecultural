import test from "node:test";
import assert from "node:assert/strict";
import { parseWhatsappCompactAddressText, buildWhatsappCompactAddressInvalidText } from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3K — reemplaza el sub-flujo de dirección manual paso a paso (calle
// → altura → ciudad → provincia, 4 preguntas) por un único mensaje
// compacto ("San Martín 850, General Roca, Río Negro"). Los parsers
// puntuales de esa versión anterior (parseWhatsappStreetNumberText,
// resolveArgentinaProvinceIndexReply, buildLocationProvincePromptText/
// InvalidText) ya no existen — parseWhatsappCompactAddressText es la
// única función real de este sub-flujo.

test("a well-formed compact address (calle+altura, ciudad, provincia) parses correctly", () => {
    const result = parseWhatsappCompactAddressText("San Martín 850, General Roca, Río Negro");
    assert.deepEqual(result, {
        address: "San Martín 850",
        city: "General Roca",
        province: "Río Negro",
        venueName: null,
        latitude: null,
        longitude: null,
        googlePlaceId: null,
    });
});

test("province matching is case/accent-insensitive but otherwise exact", () => {
    const result = parseWhatsappCompactAddressText("San Martin 850, General Roca, rio negro");
    assert.equal(result.province, "Río Negro");
});

test("tolerates extra spaces around each comma-separated part", () => {
    const result = parseWhatsappCompactAddressText("  San Martín 850  ,  General Roca ,  Río Negro  ");
    assert.equal(result.address, "San Martín 850");
    assert.equal(result.city, "General Roca");
    assert.equal(result.province, "Río Negro");
});

test("missing a part (only 2 commas' worth of data) is rejected, never guessed", () => {
    assert.equal(parseWhatsappCompactAddressText("San Martín 850, General Roca"), null);
});

test("an extra part (4 comma-separated segments) is rejected, never guessed which to drop", () => {
    assert.equal(parseWhatsappCompactAddressText("San Martín 850, General Roca, Río Negro, Argentina"), null);
});

test("a province that doesn't match any real Argentine province is rejected, never invented", () => {
    assert.equal(parseWhatsappCompactAddressText("San Martín 850, General Roca, Neverland"), null);
});

test("free text with no commas at all is rejected", () => {
    assert.equal(parseWhatsappCompactAddressText("no sé la dirección"), null);
    assert.equal(parseWhatsappCompactAddressText(""), null);
});

test("never throws on non-string input", () => {
    assert.equal(parseWhatsappCompactAddressText(null), null);
    assert.equal(parseWhatsappCompactAddressText(undefined), null);
});

test("buildWhatsappCompactAddressInvalidText explains the comma-separated format with a real example", () => {
    const text = buildWhatsappCompactAddressInvalidText();
    assert.ok(text.includes("San Martín 850, General Roca, Río Negro"));
});
