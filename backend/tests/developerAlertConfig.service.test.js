import test from "node:test";
import assert from "node:assert/strict";
import { validateDeveloperAlertConfigInput } from "../src/services/developerAlertConfig.service.js";

// Alertas Developer — validación PURA (nunca toca la base, nunca lanza),
// mismo criterio que serviceFee.service.test.js: se puede probar sin DB
// aunque el módulo importe prisma.js transitivamente (nunca se ejecuta
// ninguna query acá, así que corre seguro bajo `npm run test:unit`).

const VALID_INPUT = {
    highTicketPriceThreshold: 500000,
    highSaleQuantityThreshold: 50,
    eventsWindowCount: 10,
    eventsWindowHours: 24,
    salesVolumeWindowCount: 100,
    salesVolumeWindowMinutes: 60,
    refundsVolumeWindowCount: 10,
    refundsVolumeWindowHours: 24,
    withdrawalRequestsWindowCount: 5,
    withdrawalRequestsWindowHours: 24,
    alertCooldownMinutes: 60,
};

test("a fully valid config passes validation and returns the sanitized values", () => {
    const { valid, errors, sanitized } = validateDeveloperAlertConfigInput(VALID_INPUT);
    assert.equal(valid, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(sanitized, VALID_INPUT);
});

test("alertCooldownMinutes accepts 0 (no cooldown) — it's the only field allowed to be zero", () => {
    const { valid, sanitized } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, alertCooldownMinutes: 0 });
    assert.equal(valid, true);
    assert.equal(sanitized.alertCooldownMinutes, 0);
});

test("highTicketPriceThreshold <= 0 is rejected", () => {
    const { valid, errors } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, highTicketPriceThreshold: 0 });
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});

test("highTicketPriceThreshold accepts a non-integer amount (it's a monetary value, not a count)", () => {
    const { valid, sanitized } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, highTicketPriceThreshold: 123456.789 });
    assert.equal(valid, true);
    assert.equal(sanitized.highTicketPriceThreshold, 123456.79);
});

for (const field of [
    "highSaleQuantityThreshold",
    "eventsWindowCount",
    "eventsWindowHours",
    "salesVolumeWindowCount",
    "salesVolumeWindowMinutes",
    "refundsVolumeWindowCount",
    "refundsVolumeWindowHours",
    "withdrawalRequestsWindowCount",
    "withdrawalRequestsWindowHours",
]) {
    test(`${field} must be a positive integer — 0 is rejected`, () => {
        const { valid, errors } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, [field]: 0 });
        assert.equal(valid, false);
        assert.ok(errors.length > 0);
    });

    test(`${field} must be a positive integer — a decimal is rejected`, () => {
        const { valid } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, [field]: 1.5 });
        assert.equal(valid, false);
    });

    test(`${field} must be a positive integer — negative is rejected`, () => {
        const { valid } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, [field]: -1 });
        assert.equal(valid, false);
    });
}

test("alertCooldownMinutes negative is rejected", () => {
    const { valid, errors } = validateDeveloperAlertConfigInput({ ...VALID_INPUT, alertCooldownMinutes: -1 });
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});

test("multiple invalid fields are all collected, not just the first one", () => {
    const { valid, errors } = validateDeveloperAlertConfigInput({
        ...VALID_INPUT,
        highTicketPriceThreshold: -1,
        highSaleQuantityThreshold: 0,
        alertCooldownMinutes: -5,
    });
    assert.equal(valid, false);
    assert.ok(errors.length >= 3, `expected at least 3 errors, got ${errors.length}`);
});

test("missing fields entirely (empty object) are rejected with errors, never thrown", () => {
    const { valid, errors } = validateDeveloperAlertConfigInput({});
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});
