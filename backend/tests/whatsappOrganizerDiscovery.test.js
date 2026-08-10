import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrganizationSelectionChoice } from "../src/services/whatsappOrganizerDiscovery.service.js";

// Fase 2G — única función pura de whatsappOrganizerDiscovery.service.js
// (el resto toca Prisma; se ejercita indirectamente vía
// tests/whatsapp.organizerBot.test.js, mismo criterio que
// whatsappOrganizerLink.test.js con las funciones puras de Fase 2F).

const CANDIDATES = ["org_1", "org_2", "org_3"];

test("resolveOrganizationSelectionChoice: a valid 1-based index resolves the matching organizationId", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "1"), { valid: true, organizationId: "org_1" });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "2"), { valid: true, organizationId: "org_2" });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "3"), { valid: true, organizationId: "org_3" });
});

test("resolveOrganizationSelectionChoice: tolerates surrounding whitespace", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "  2  "), { valid: true, organizationId: "org_2" });
});

test("resolveOrganizationSelectionChoice: rejects an index of zero or negative", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "0"), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "-1"), { valid: false });
});

test("resolveOrganizationSelectionChoice: rejects an index past the end of the real candidate list", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "4"), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "999"), { valid: false });
});

test("resolveOrganizationSelectionChoice: never accepts a manually-typed organizationId, name, clerkId or free text", () => {
    for (const rawText of ["org_2", "Elvis Bar", "user_123", "clerkId=org_2", "2do", "2.0", "2 "]) {
        const result = resolveOrganizationSelectionChoice(CANDIDATES, rawText);
        if (rawText === "2 ") continue; // whitespace-trimmed numeric — valid on purpose, covered above
        assert.equal(result.valid, false, `esperaba valid:false para "${rawText}"`);
    }
});

test("resolveOrganizationSelectionChoice: rejects non-string/empty input without throwing", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, ""), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, null), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, undefined), { valid: false });
});

test("resolveOrganizationSelectionChoice: with a single candidate, only '1' is valid", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(["org_1"], "1"), { valid: true, organizationId: "org_1" });
    assert.deepEqual(resolveOrganizationSelectionChoice(["org_1"], "2"), { valid: false });
});
