import test from "node:test";
import assert from "node:assert/strict";
import {
    validateOrganizerNotificationSettingsInput,
    computeCrossedStepMilestones,
    hasCrossedThresholdDown,
    hasJustSoldOut,
} from "../src/services/organizerNotificationSettings.service.js";

// Notificaciones Organizer — validación y aritmética de cruce de umbral,
// todo PURO (nunca toca la base, nunca lanza), mismo criterio que
// withdrawalRequest.pure.test.js. Corre seguro bajo `npm run test:unit`.

const VALID_INPUT = {
    saleConfirmedEnabled: true,
    salesMilestoneEnabled: true,
    salesMilestoneCount: 100,
    lowStockEnabled: true,
    lowStockPercent: 20,
    eventReminderEnabled: false,
    eventReminderHoursBefore: 24,
    eventStartEnabled: false,
    eventEndEnabled: false,
    scannerActivityEnabled: false,
};

test("a fully valid config passes validation and returns the sanitized values", () => {
    const { valid, errors, sanitized } = validateOrganizerNotificationSettingsInput(VALID_INPUT);
    assert.equal(valid, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(sanitized, VALID_INPUT);
});

for (const field of ["saleConfirmedEnabled", "salesMilestoneEnabled", "lowStockEnabled", "eventReminderEnabled", "eventStartEnabled", "eventEndEnabled", "scannerActivityEnabled"]) {
    test(`${field} must be a boolean — a string is rejected`, () => {
        const { valid, errors } = validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, [field]: "yes" });
        assert.equal(valid, false);
        assert.ok(errors.length > 0);
    });
}

for (const field of ["salesMilestoneCount", "eventReminderHoursBefore"]) {
    test(`${field} must be a positive integer — 0 is rejected`, () => {
        const { valid } = validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, [field]: 0 });
        assert.equal(valid, false);
    });
    test(`${field} must be a positive integer — a decimal is rejected`, () => {
        const { valid } = validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, [field]: 1.5 });
        assert.equal(valid, false);
    });
}

test("lowStockPercent must be an integer strictly between 0 and 100", () => {
    assert.equal(validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, lowStockPercent: 0 }).valid, false);
    assert.equal(validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, lowStockPercent: 100 }).valid, false);
    assert.equal(validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, lowStockPercent: 50.5 }).valid, false);
    assert.equal(validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, lowStockPercent: 99 }).valid, true);
    assert.equal(validateOrganizerNotificationSettingsInput({ ...VALID_INPUT, lowStockPercent: 1 }).valid, true);
});

test("multiple invalid fields are all collected, not just the first one", () => {
    const { valid, errors } = validateOrganizerNotificationSettingsInput({
        ...VALID_INPUT,
        salesMilestoneCount: -1,
        lowStockPercent: 150,
        saleConfirmedEnabled: "nope",
    });
    assert.equal(valid, false);
    assert.ok(errors.length >= 3, `expected at least 3 errors, got ${errors.length}`);
});

test("missing fields entirely (empty object) are rejected with errors, never thrown", () => {
    const { valid, errors } = validateOrganizerNotificationSettingsInput({});
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});

// --- computeCrossedStepMilestones (hito de ventas) ---

test("computeCrossedStepMilestones: no milestone crossed when the range doesn't reach the next multiple", () => {
    assert.deepEqual(computeCrossedStepMilestones(50, 90, 100), []);
});

test("computeCrossedStepMilestones: exactly one milestone crossed", () => {
    assert.deepEqual(computeCrossedStepMilestones(90, 105, 100), [100]);
});

test("computeCrossedStepMilestones: a single large sale can cross several milestones at once", () => {
    assert.deepEqual(computeCrossedStepMilestones(80, 230, 100), [100, 200]);
});

test("computeCrossedStepMilestones: landing exactly on the boundary counts as crossed", () => {
    assert.deepEqual(computeCrossedStepMilestones(0, 100, 100), [100]);
});

test("computeCrossedStepMilestones: starting exactly on a multiple never re-fires that same one", () => {
    assert.deepEqual(computeCrossedStepMilestones(100, 100, 100), []);
    assert.deepEqual(computeCrossedStepMilestones(100, 150, 100), []);
});

test("computeCrossedStepMilestones: a non-positive step returns no milestones", () => {
    assert.deepEqual(computeCrossedStepMilestones(0, 500, 0), []);
    assert.deepEqual(computeCrossedStepMilestones(0, 500, -10), []);
});

// --- hasCrossedThresholdDown (stock bajo) ---

test("hasCrossedThresholdDown: true when a sale pushes availability from above to at-or-below the threshold", () => {
    assert.equal(hasCrossedThresholdDown(205, 195, 200), true);
});

test("hasCrossedThresholdDown: false when availability was already at or below the threshold", () => {
    assert.equal(hasCrossedThresholdDown(200, 190, 200), false);
});

test("hasCrossedThresholdDown: false when availability stays above the threshold", () => {
    assert.equal(hasCrossedThresholdDown(500, 480, 200), false);
});

// --- hasJustSoldOut (agotado) ---

test("hasJustSoldOut: true only on the sale that brings availability from something to exactly zero", () => {
    assert.equal(hasJustSoldOut(3, 0), true);
});

test("hasJustSoldOut: false if it was already sold out before this sale", () => {
    assert.equal(hasJustSoldOut(0, 0), false);
});

test("hasJustSoldOut: false if it doesn't reach zero", () => {
    assert.equal(hasJustSoldOut(3, 1), false);
});
