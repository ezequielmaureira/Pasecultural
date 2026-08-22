import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArgentinePhoneForMatching, isSameArgentinePhone, buildArgentineWhatsappId } from "../src/utils/normalizeArgentinePhone.js";

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

// ==================================================
// buildArgentineWhatsappId — movidos acá desde whatsappNumberChange.pure.test.js
// (retirado junto con el sistema viejo de "número autorizado"): esta
// función es una utilidad compartida, no algo propio de ese dominio — la
// usa activamente organizationPhoneVerification.service.js.
// ==================================================

test("buildArgentineWhatsappId: builds the canonical 549+10-digit waId from a +54 9 formatted number", () => {
    assert.equal(buildArgentineWhatsappId("+54 9 299 451-4062"), "5492994514062");
});

test("buildArgentineWhatsappId: accepts a bare national number without prefixes", () => {
    assert.equal(buildArgentineWhatsappId("2994514062"), "5492994514062");
});

test("buildArgentineWhatsappId: accepts 0-prefixed domestic dialing format", () => {
    assert.equal(buildArgentineWhatsappId("02994514062"), "5492994514062");
});

test("buildArgentineWhatsappId: accepts an already-9-prefixed international format", () => {
    assert.equal(buildArgentineWhatsappId("549 2994514062"), "5492994514062");
});

test("buildArgentineWhatsappId: rejects a number that cannot be interpreted with certainty, never guesses", () => {
    assert.equal(buildArgentineWhatsappId("12345"), null);
    assert.equal(buildArgentineWhatsappId(""), null);
    assert.equal(buildArgentineWhatsappId("abc"), null);
    assert.equal(buildArgentineWhatsappId(null), null);
    assert.equal(buildArgentineWhatsappId(undefined), null);
});

test("buildArgentineWhatsappId: two different area codes with the same local number never collide", () => {
    const a = buildArgentineWhatsappId("358-4123456");
    const b = buildArgentineWhatsappId("351-4123456");
    assert.notEqual(a, b);
});
