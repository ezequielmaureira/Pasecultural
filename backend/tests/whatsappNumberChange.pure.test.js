import test from "node:test";
import assert from "node:assert/strict";
import {
    evaluateNumberChangeChallengeLookup,
    evaluateNumberChangeAttempts,
    shouldSendNewNumberChangeCode,
} from "../src/services/whatsappNumberChange.service.js";
import { buildArgentineWhatsappId } from "../src/utils/normalizeArgentinePhone.js";

// Funciones puras de whatsappNumberChange.service.js/normalizeArgentinePhone.js,
// testeadas sin Prisma (mismo criterio que whatsappOrganizerLink.test.js).

// ==================================================
// evaluateNumberChangeChallengeLookup
// ==================================================

test("evaluateNumberChangeChallengeLookup: NOT_FOUND when there is no challenge", () => {
    assert.deepEqual(evaluateNumberChangeChallengeLookup({ challenge: null, now: new Date() }), { status: "NOT_FOUND" });
});

test("evaluateNumberChangeChallengeLookup: EXPIRED when expiresAt already passed", () => {
    const now = new Date("2026-01-01T00:10:01.000Z");
    const challenge = { expiresAt: new Date("2026-01-01T00:10:00.000Z") };
    assert.deepEqual(evaluateNumberChangeChallengeLookup({ challenge, now }), { status: "EXPIRED" });
});

test("evaluateNumberChangeChallengeLookup: VALID when found and still within its window", () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const challenge = { expiresAt: new Date("2026-01-01T00:10:00.000Z") };
    assert.deepEqual(evaluateNumberChangeChallengeLookup({ challenge, now }), { status: "VALID" });
});

// 7) OTP vencido — consumido/borrado se comporta igual que "nunca existió".
test("evaluateNumberChangeChallengeLookup: a consumed (deleted) challenge behaves exactly like NOT_FOUND", () => {
    assert.equal(evaluateNumberChangeChallengeLookup({ challenge: null, now: new Date() }).status, "NOT_FOUND");
});

// ==================================================
// evaluateNumberChangeAttempts — 8) demasiados intentos bloquean
// ==================================================

test("evaluateNumberChangeAttempts: not blocked with zero attempts", () => {
    assert.deepEqual(evaluateNumberChangeAttempts({ attempts: 0 }), { blocked: false });
});

test("evaluateNumberChangeAttempts: not blocked at 4 attempts (max is 5)", () => {
    assert.deepEqual(evaluateNumberChangeAttempts({ attempts: 4 }), { blocked: false });
});

test("evaluateNumberChangeAttempts: blocked once attempts reaches the max", () => {
    assert.deepEqual(evaluateNumberChangeAttempts({ attempts: 5 }), { blocked: true });
});

test("evaluateNumberChangeAttempts: still blocked past the max", () => {
    assert.deepEqual(evaluateNumberChangeAttempts({ attempts: 12 }), { blocked: true });
});

// ==================================================
// shouldSendNewNumberChangeCode — 18) resend respeta cooldown
// ==================================================

test("shouldSendNewNumberChangeCode: true when there is no existing challenge", () => {
    assert.equal(shouldSendNewNumberChangeCode({ existing: null, now: new Date() }), true);
});

test("shouldSendNewNumberChangeCode: true when the existing challenge already expired, regardless of cooldown", () => {
    const now = new Date("2026-01-01T00:20:00.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:19:50.000Z") };
    assert.equal(shouldSendNewNumberChangeCode({ existing, now }), true);
});

test("shouldSendNewNumberChangeCode: false when a valid challenge was just sent (within cooldown)", () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:00:00.000Z") };
    assert.equal(shouldSendNewNumberChangeCode({ existing, now }), false);
});

test("shouldSendNewNumberChangeCode: true once the cooldown window has elapsed", () => {
    const now = new Date("2026-01-01T00:01:01.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:00:00.000Z") };
    assert.equal(shouldSendNewNumberChangeCode({ existing, now }), true);
});

// ==================================================
// buildArgentineWhatsappId — 3) número inválido rechazado (normalización)
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
