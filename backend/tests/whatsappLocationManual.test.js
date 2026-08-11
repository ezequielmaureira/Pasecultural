import test from "node:test";
import assert from "node:assert/strict";
import {
    parseWhatsappStreetNumberText,
    resolveArgentinaProvinceIndexReply,
    buildLocationProvincePromptText,
    buildLocationProvinceInvalidText,
} from "../src/services/whatsappOrganizerBot.service.js";
import { ARGENTINA_PROVINCES } from "../src/utils/argentinaProvinces.js";

// Fase 3D — parsers puros del sub-flujo de dirección manual (calle → altura
// → ciudad → provincia).

// ==================================================
// parseWhatsappStreetNumberText — altura
// ==================================================

test("a plain positive integer is a valid street number", () => {
    assert.equal(parseWhatsappStreetNumberText("850"), "850");
    assert.equal(parseWhatsappStreetNumberText("1"), "1");
});

test("tolerates surrounding whitespace", () => {
    assert.equal(parseWhatsappStreetNumberText("  850  "), "850");
});

test("zero is not a valid street number", () => {
    assert.equal(parseWhatsappStreetNumberText("0"), null);
});

test("non-numeric text is never a valid street number", () => {
    assert.equal(parseWhatsappStreetNumberText("abc"), null);
    assert.equal(parseWhatsappStreetNumberText(""), null);
});

test("negative or decimal numbers are never valid", () => {
    assert.equal(parseWhatsappStreetNumberText("-5"), null);
    assert.equal(parseWhatsappStreetNumberText("8.5"), null);
});

test("never throws on non-string input", () => {
    assert.equal(parseWhatsappStreetNumberText(null), null);
    assert.equal(parseWhatsappStreetNumberText(undefined), null);
});

// ==================================================
// resolveArgentinaProvinceIndexReply — índice 1-based EXACTO, nunca
// coincidencia parcial/fuzzy.
// ==================================================

test("a valid 1-based index resolves the real province name", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("1"), "Buenos Aires");
    assert.equal(resolveArgentinaProvinceIndexReply("5"), "Córdoba");
    assert.equal(resolveArgentinaProvinceIndexReply(String(ARGENTINA_PROVINCES.length)), "Ciudad Autónoma de Buenos Aires");
});

test("index 0 or negative is rejected", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("0"), null);
    assert.equal(resolveArgentinaProvinceIndexReply("-1"), null);
});

test("an out-of-range index (99) is rejected", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("99"), null);
    assert.equal(resolveArgentinaProvinceIndexReply(String(ARGENTINA_PROVINCES.length + 1)), null);
});

test("never accepts a written province name (no fuzzy matching)", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("Córdoba"), null);
    assert.equal(resolveArgentinaProvinceIndexReply("cordoba"), null);
});

test("never accepts free text", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("no sé"), null);
    assert.equal(resolveArgentinaProvinceIndexReply(""), null);
});

test("tolerates surrounding whitespace around a valid index", () => {
    assert.equal(resolveArgentinaProvinceIndexReply("  1  "), "Buenos Aires");
});

// ==================================================
// Renderers — orden idéntico a ARGENTINA_PROVINCES, nunca reordenado.
// ==================================================

test("buildLocationProvincePromptText lists every province numbered, in the exact array order", () => {
    const text = buildLocationProvincePromptText();
    assert.ok(text.includes("1. Buenos Aires"));
    assert.ok(text.includes(`${ARGENTINA_PROVINCES.length}. Ciudad Autónoma de Buenos Aires`));
    assert.ok(text.indexOf("1. Buenos Aires") < text.indexOf("2. Catamarca"));
});

test("buildLocationProvinceInvalidText also lists every province numbered", () => {
    const text = buildLocationProvinceInvalidText();
    assert.ok(text.includes("1. Buenos Aires"));
    assert.ok(text.startsWith("❌"));
});
