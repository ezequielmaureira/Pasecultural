import test from "node:test";
import assert from "node:assert/strict";

// Sin Prisma real: DATABASE_URL a un puerto cerrado, igual criterio que
// userSuspension.unit.test.js — estas funciones son puras.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;

const {
    addCalendarMonths,
    initialServiceFeeWaivedUntil,
    isServiceFeeWaived,
    getServiceFeeWaiverStatus,
    isValidServiceFeeWaiverDurationMonths,
    MAX_SERVICE_FEE_WAIVER_DURATION_MONTHS,
} = await import(
    "../src/services/serviceFeeWaiver.service.js"
);
const { calculateServiceFeeForUnitPrice } = await import("../src/services/serviceFee.service.js");

// Hora argentina explícita (UTC-3) para que el test no dependa de la zona
// de la máquina.
const ar = (isoLocal) => new Date(`${isoLocal}-03:00`);

test("+1 mes calendario: 10/12/2026 → 10/01/2027, misma hora", () => {
    assert.equal(addCalendarMonths(ar("2026-12-10T21:15:00"), 1).toISOString(), ar("2027-01-10T21:15:00").toISOString());
});

test("+1 mes calendario: 15/09 → 15/10 (no 30 días)", () => {
    assert.equal(addCalendarMonths(ar("2026-09-15T10:00:00"), 1).toISOString(), ar("2026-10-15T10:00:00").toISOString());
    // 30 días habrían dado 15/10 también en septiembre; julio lo distingue.
    assert.equal(addCalendarMonths(ar("2026-07-15T10:00:00"), 1).toISOString(), ar("2026-08-15T10:00:00").toISOString());
});

test("+1 mes calendario: fin de mes usa el último día del mes siguiente", () => {
    assert.equal(addCalendarMonths(ar("2027-01-31T12:00:00"), 1).toISOString(), ar("2027-02-28T12:00:00").toISOString());
    assert.equal(addCalendarMonths(ar("2028-01-31T12:00:00"), 1).toISOString(), ar("2028-02-29T12:00:00").toISOString());
    assert.equal(addCalendarMonths(ar("2026-03-31T12:00:00"), 1).toISOString(), ar("2026-04-30T12:00:00").toISOString());
});

test("+1 mes calendario: se calcula en hora argentina aunque en UTC ya sea otro día", () => {
    // 30/01 22:00 AR = 31/01 01:00 UTC. En UTC daría 28/02 01:00 UTC
    // (= 27/02 en Argentina); la regla correcta es 28/02 22:00 AR.
    assert.equal(addCalendarMonths(ar("2027-01-30T22:00:00"), 1).toISOString(), ar("2027-02-28T22:00:00").toISOString());
    assert.equal(addCalendarMonths(ar("2026-12-31T23:30:00"), 1).toISOString(), ar("2027-01-31T23:30:00").toISOString());
});

test("vigencia: antes del vencimiento $0, exactamente en el vencimiento y después NO", () => {
    const until = ar("2027-01-10T21:15:00");
    const org = { serviceFeeWaivedUntil: until };
    assert.equal(isServiceFeeWaived(org, new Date(until.getTime() - 1)), true);
    assert.equal(isServiceFeeWaived(org, until), false);
    assert.equal(isServiceFeeWaived(org, new Date(until.getTime() + 1)), false);
    assert.equal(isServiceFeeWaived({ serviceFeeWaivedUntil: null }, until), false);
    assert.equal(isServiceFeeWaived(null, until), false);
});

test("estado: SIN INICIAR / ACTIVO / VENCIDO (organización antigua publicada el 15/09)", () => {
    const until = addCalendarMonths(ar("2026-09-15T10:00:00"), 1);
    assert.equal(getServiceFeeWaiverStatus({ serviceFeeWaivedUntil: null }), "NOT_STARTED");
    // Publicó con la duración configurada en 0: sin promoción, no "sin iniciar".
    assert.equal(getServiceFeeWaiverStatus({ firstEventPublishedAt: ar("2026-09-15T10:00:00"), serviceFeeWaivedUntil: null }), "NONE");
    assert.equal(getServiceFeeWaiverStatus({ serviceFeeWaivedUntil: until }, ar("2026-10-08T12:00:00")), "ACTIVE");
    assert.equal(getServiceFeeWaiverStatus({ serviceFeeWaivedUntil: until }, ar("2026-10-20T12:00:00")), "EXPIRED");
});

test("sin beneficio: límites de todos los rangos vigentes (sin porcentajes)", () => {
    const tiers = [
        { minAmount: 0, maxAmount: 1000, feeAmount: 1 },
        { minAmount: 1000, maxAmount: 5000, feeAmount: 150 },
        { minAmount: 5000, maxAmount: 10000, feeAmount: 200 },
        { minAmount: 10000, maxAmount: 50000, feeAmount: 1000 },
        { minAmount: 50000, maxAmount: null, feeAmount: 2000 },
    ];
    const cases = [
        [0, 0], [1, 1], [999, 1], [999.99, 1], [1000, 150], [4999, 150], [5000, 200], [9999, 200],
        [10000, 1000], [49999, 1000], [50000, 2000], [150000, 2000], [999999999, 2000],
    ];
    for (const [price, fee] of cases) {
        assert.equal(calculateServiceFeeForUnitPrice(price, tiers), fee, `precio ${price}`);
    }
});

test("N meses calendario: 10/12/2026 + 2 → 10/02/2027; + 3 → 10/03/2027; + 12 → 10/12/2027", () => {
    const first = ar("2026-12-10T21:15:00");
    assert.equal(addCalendarMonths(first, 2).toISOString(), ar("2027-02-10T21:15:00").toISOString());
    assert.equal(addCalendarMonths(first, 3).toISOString(), ar("2027-03-10T21:15:00").toISOString());
    assert.equal(addCalendarMonths(first, 12).toISOString(), ar("2027-12-10T21:15:00").toISOString());
    assert.equal(addCalendarMonths(first, 0).toISOString(), first.toISOString());
});

test("N meses calendario: fin de mes en saltos de varios meses", () => {
    assert.equal(addCalendarMonths(ar("2026-12-31T12:00:00"), 2).toISOString(), ar("2027-02-28T12:00:00").toISOString());
    assert.equal(addCalendarMonths(ar("2027-11-30T12:00:00"), 3).toISOString(), ar("2028-02-29T12:00:00").toISOString());
    assert.equal(addCalendarMonths(ar("2027-01-31T12:00:00"), 2).toISOString(), ar("2027-03-31T12:00:00").toISOString());
});

test("cantidad de meses inválida lanza (nunca suma algo inventado)", () => {
    for (const bad of [-1, 1.5, "2", null, undefined, NaN]) {
        assert.throws(() => addCalendarMonths(new Date(), bad), RangeError);
    }
});

test("vencimiento inicial: 0 → null (sin promoción); 1 → +1; 2 → +2", () => {
    const first = ar("2026-12-10T21:15:00");
    assert.equal(initialServiceFeeWaivedUntil(first, 0), null);
    assert.equal(initialServiceFeeWaivedUntil(first, 1).toISOString(), ar("2027-01-10T21:15:00").toISOString());
    assert.equal(initialServiceFeeWaivedUntil(first, 2).toISOString(), ar("2027-02-10T21:15:00").toISOString());
});

test("configuración: enteros de 0 a 12 válidos; el resto no", () => {
    assert.equal(MAX_SERVICE_FEE_WAIVER_DURATION_MONTHS, 12);
    for (const ok of [0, 1, 2, 3, 12]) assert.equal(isValidServiceFeeWaiverDurationMonths(ok), true, String(ok));
    for (const bad of [-1, 13, 1.5, "1", null, undefined, NaN, 1000]) assert.equal(isValidServiceFeeWaiverDurationMonths(bad), false, String(bad));
});
