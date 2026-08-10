import test from "node:test";
import assert from "node:assert/strict";
import {
    evaluateWhatsappLinkChallengeLookup,
    evaluateOrganizationLinkAttempts,
    shouldCreateNewChallenge,
} from "../src/services/whatsappOrganizerLink.service.js";

// Fase 2F — funciones puras de whatsappOrganizerLink.service.js, testeadas
// sin Prisma (mismo criterio que buildBulkTicketActionPlan en
// ticketAdmin.service.js): reciben datos ya leídos y sólo deciden.

// ==================================================
// evaluateWhatsappLinkChallengeLookup — B/E/G del pedido (expiración,
// "no existe"/consumido)
// ==================================================

test("evaluateWhatsappLinkChallengeLookup: NOT_FOUND when no challenge matches the submitted code's hash", () => {
    assert.deepEqual(evaluateWhatsappLinkChallengeLookup({ challenge: null, now: new Date() }), { status: "NOT_FOUND" });
});

test("evaluateWhatsappLinkChallengeLookup: EXPIRED when the challenge's expiresAt already passed", () => {
    const now = new Date("2026-01-01T00:10:01.000Z");
    const challenge = { expiresAt: new Date("2026-01-01T00:10:00.000Z") };
    assert.deepEqual(evaluateWhatsappLinkChallengeLookup({ challenge, now }), { status: "EXPIRED" });
});

test("evaluateWhatsappLinkChallengeLookup: VALID when found and still within its 10-minute window", () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const challenge = { expiresAt: new Date("2026-01-01T00:10:00.000Z") };
    assert.deepEqual(evaluateWhatsappLinkChallengeLookup({ challenge, now }), { status: "VALID" });
});

// G) challenge consumido -> no reutilizable: una vez que
// linkWhatsappOrganizerService borra la fila (ver el service), una
// segunda verificación con el mismo código vuelve a caer acá con
// challenge=null (mismo resultado que un código que nunca existió).
test("evaluateWhatsappLinkChallengeLookup: a consumed (deleted) challenge behaves exactly like NOT_FOUND", () => {
    assert.deepEqual(evaluateWhatsappLinkChallengeLookup({ challenge: null, now: new Date() }).status, "NOT_FOUND");
});

// ==================================================
// evaluateOrganizationLinkAttempts — C/D del pedido (intentos, bloqueo)
// ==================================================

test("evaluateOrganizationLinkAttempts: not blocked with zero prior attempts", () => {
    const result = evaluateOrganizationLinkAttempts({ failedAttempts: 0, windowStartedAt: null, now: new Date() });
    assert.deepEqual(result, { blocked: false, effectiveAttempts: 0 });
});

// D) 5 intentos fallidos -> bloqueado.
test("evaluateOrganizationLinkAttempts: blocked once failedAttempts reaches the max within the window", () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const windowStartedAt = new Date("2026-01-01T00:00:00.000Z");
    const result = evaluateOrganizationLinkAttempts({ failedAttempts: 5, windowStartedAt, now });
    assert.equal(result.blocked, true);
});

test("evaluateOrganizationLinkAttempts: 4 failed attempts within the window is not yet blocked", () => {
    const now = new Date("2026-01-01T00:05:00.000Z");
    const windowStartedAt = new Date("2026-01-01T00:00:00.000Z");
    const result = evaluateOrganizationLinkAttempts({ failedAttempts: 4, windowStartedAt, now });
    assert.equal(result.blocked, false);
});

// La ventana se autolimpia: 5 intentos viejos (fuera de la ventana de 10
// minutos) no bloquean un intento nuevo.
test("evaluateOrganizationLinkAttempts: attempts outside the time window reset to zero", () => {
    const now = new Date("2026-01-01T00:20:00.000Z");
    const windowStartedAt = new Date("2026-01-01T00:00:00.000Z"); // 20 min atrás
    const result = evaluateOrganizationLinkAttempts({ failedAttempts: 5, windowStartedAt, now });
    assert.deepEqual(result, { blocked: false, effectiveAttempts: 0 });
});

// ==================================================
// shouldCreateNewChallenge — sección 5 (cooldown de reemplazo)
// ==================================================

test("shouldCreateNewChallenge: true when there is no existing challenge for this wa_id", () => {
    assert.equal(shouldCreateNewChallenge({ existing: null, now: new Date() }), true);
});

test("shouldCreateNewChallenge: true when the existing challenge already expired, regardless of cooldown", () => {
    const now = new Date("2026-01-01T00:20:00.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:19:50.000Z") };
    assert.equal(shouldCreateNewChallenge({ existing, now }), true);
});

test("shouldCreateNewChallenge: false when a valid challenge was just sent (within cooldown)", () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:00:00.000Z") };
    assert.equal(shouldCreateNewChallenge({ existing, now }), false);
});

test("shouldCreateNewChallenge: true once the cooldown window has elapsed", () => {
    const now = new Date("2026-01-01T00:01:01.000Z");
    const existing = { expiresAt: new Date("2026-01-01T00:10:00.000Z"), lastSentAt: new Date("2026-01-01T00:00:00.000Z") };
    assert.equal(shouldCreateNewChallenge({ existing, now }), true);
});
