import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArgentinePhoneForMatching, isSameArgentinePhone } from "../src/utils/normalizeArgentinePhone.js";

// Un mismo número real de Córdoba (351 4123456), escrito en todos los
// formatos que Meta/una organización pueden mandar/cargar — todos deben
// normalizar EXACTAMENTE al mismo "número nacional significativo".
const EQUIVALENT_FORMATS = [
    "+54 9 351 412-3456",
    "5493514123456",
    "54 351 4123456",
    "0351 4123456",
    "3514123456",
    "(0351) 412-3456",
    "  0351   4123456  ",
];

test("normalizeArgentinePhoneForMatching reduces every documented format to the same 10-digit significant number", () => {
    const expected = "3514123456";
    for (const raw of EQUIVALENT_FORMATS) {
        assert.equal(normalizeArgentinePhoneForMatching(raw), expected, `esperaba "${expected}" para "${raw}"`);
    }
});

test("isSameArgentinePhone is true across every equivalent format, compared pairwise", () => {
    for (const a of EQUIVALENT_FORMATS) {
        for (const b of EQUIVALENT_FORMATS) {
            assert.equal(isSameArgentinePhone(a, b), true, `esperaba coincidencia entre "${a}" y "${b}"`);
        }
    }
});

test("two different area codes sharing the same local suffix never coincide (no suffix/contains matching)", () => {
    // Mismo número local (4123456), área distinta (358 vs 351): NUNCA deben
    // considerarse el mismo teléfono, ni por sufijo ni por longitud parcial.
    const areaA = "3584123456";
    const areaB = "3514123456";
    assert.notEqual(normalizeArgentinePhoneForMatching(areaA), normalizeArgentinePhoneForMatching(areaB));
    assert.equal(isSameArgentinePhone(areaA, areaB), false);
});

test("isSameArgentinePhone never matches by substring/endsWith heuristics", () => {
    // "91123456789" contiene "23456789" pero son números distintos: no debe
    // haber ninguna coincidencia parcial disfrazada de "igual".
    assert.equal(isSameArgentinePhone("91123456789", "23456789"), false);
});

test("normalizeArgentinePhoneForMatching returns null for lengths it cannot interpret with certainty", () => {
    assert.equal(normalizeArgentinePhoneForMatching(""), null);
    assert.equal(normalizeArgentinePhoneForMatching("123"), null);
    assert.equal(normalizeArgentinePhoneForMatching("54123456789012345"), null);
});

test("normalizeArgentinePhoneForMatching returns null for non-string input", () => {
    assert.equal(normalizeArgentinePhoneForMatching(null), null);
    assert.equal(normalizeArgentinePhoneForMatching(undefined), null);
    assert.equal(normalizeArgentinePhoneForMatching(3514123456), null);
});

test("isSameArgentinePhone is false whenever either side fails to normalize", () => {
    assert.equal(isSameArgentinePhone("", "3514123456"), false);
    assert.equal(isSameArgentinePhone("3514123456", null), false);
    assert.equal(isSameArgentinePhone(null, null), false);
});
