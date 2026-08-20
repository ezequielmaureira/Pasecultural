import test from "node:test";
import assert from "node:assert/strict";
import { calculateServiceFeeForUnitPrice, validateServiceFeeTiersInput } from "../src/services/serviceFee.service.js";

// MP-6 — pura, sin DB: calculateServiceFeeForUnitPrice y
// validateServiceFeeTiersInput no tocan Prisma (mismo criterio que
// argentinaProvinces.test.js). replaceServiceFeeTiers/getActiveServiceFeeTiers
// (las únicas funciones de este archivo que sí tocan la base) no se prueban
// acá — se ejercitan indirectamente vía mercadoPagoCheckout.service.test.js
// (testWithDb).

// Reglas iniciales exactas — las mismas 4 filas que inserta la migración
// (20260820120000_service_fee_tiers).
const INITIAL_TIERS = [
    { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
    { minAmount: 5000, maxAmount: 10000, feeAmount: 500 },
    { minAmount: 10000, maxAmount: 50000, feeAmount: 1000 },
    { minAmount: 50000, maxAmount: null, feeAmount: 2000 },
];

// ==================================================================
// calculateServiceFeeForUnitPrice — casos límite obligatorios de la
// auditoría, uno por uno, sin ambigüedad en $5.000/$10.000/$50.000.
// ==================================================================

test("price $0 always has fee $0, regardless of configured tiers", () => {
    assert.equal(calculateServiceFeeForUnitPrice(0, INITIAL_TIERS), 0);
    // Incluso con una configuración vacía o rota — nunca consulta la tabla.
    assert.equal(calculateServiceFeeForUnitPrice(0, []), 0);
});

test("price $4999.99 -> $150 (just under the first boundary)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(4999.99, INITIAL_TIERS), 150);
});

test("price $5000 -> $500 (inclusive lower bound of the second tier)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(5000, INITIAL_TIERS), 500);
});

test("price $9999.99 -> $500 (just under the third boundary)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(9999.99, INITIAL_TIERS), 500);
});

test("price $10000 -> $1000 (inclusive lower bound of the third tier)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(10000, INITIAL_TIERS), 1000);
});

test("price $49999.99 -> $1000 (just under the fourth boundary)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(49999.99, INITIAL_TIERS), 1000);
});

test("price $50000 -> $2000 (inclusive lower bound of the open-ended tier)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(50000, INITIAL_TIERS), 2000);
});

test("price greater than $100000 -> $2000 (open-ended tier, no upper bound)", () => {
    assert.equal(calculateServiceFeeForUnitPrice(150000, INITIAL_TIERS), 2000);
    assert.equal(calculateServiceFeeForUnitPrice(9999999, INITIAL_TIERS), 2000);
});

test("a positive price that falls in no configured tier returns null, never a silent $0", () => {
    const gappedTiers = [
        { minAmount: 0, maxAmount: 1000, feeAmount: 100 },
        { minAmount: 2000, maxAmount: null, feeAmount: 200 },
    ];
    assert.equal(calculateServiceFeeForUnitPrice(1500, gappedTiers), null);
});

// ==================================================================
// Ejemplos obligatorios de la auditoría — cantidad múltiple y compra
// mixta, calculados a mano a partir de calculateServiceFeeForUnitPrice
// (el mismo cálculo que usa createSaleForBuyer por item, multiplicado por
// cantidad — nunca sobre el subtotal global).
// ==================================================================

test("1 entrada de $4.000 -> subtotal $4.000, servicio $150, total $4.150", () => {
    const unitFee = calculateServiceFeeForUnitPrice(4000, INITIAL_TIERS);
    assert.equal(unitFee, 150);
    assert.equal(4000 + unitFee, 4150);
});

test("3 entradas de $8.000 -> subtotal $24.000, servicio $1.500, total $25.500", () => {
    const unitFee = calculateServiceFeeForUnitPrice(8000, INITIAL_TIERS);
    const subtotal = 8000 * 3;
    const serviceFee = unitFee * 3;
    assert.equal(unitFee, 500);
    assert.equal(subtotal, 24000);
    assert.equal(serviceFee, 1500);
    assert.equal(subtotal + serviceFee, 25500);
});

test("3 entradas de $10.000 -> subtotal $30.000, servicio $3.000, total $33.000", () => {
    const unitFee = calculateServiceFeeForUnitPrice(10000, INITIAL_TIERS);
    const subtotal = 10000 * 3;
    const serviceFee = unitFee * 3;
    assert.equal(unitFee, 1000);
    assert.equal(subtotal, 30000);
    assert.equal(serviceFee, 3000);
    assert.equal(subtotal + serviceFee, 33000);
});

test("2 entradas de $120.000 -> subtotal $240.000, servicio $4.000, total $244.000", () => {
    const unitFee = calculateServiceFeeForUnitPrice(120000, INITIAL_TIERS);
    const subtotal = 120000 * 2;
    const serviceFee = unitFee * 2;
    assert.equal(unitFee, 2000);
    assert.equal(subtotal, 240000);
    assert.equal(serviceFee, 4000);
    assert.equal(subtotal + serviceFee, 244000);
});

test("compra mixta: 2 x $8.000 + 1 x $60.000 -> subtotal $76.000, servicio $3.000, total $79.000 (nunca sobre el subtotal global)", () => {
    const feeA = calculateServiceFeeForUnitPrice(8000, INITIAL_TIERS);
    const feeB = calculateServiceFeeForUnitPrice(60000, INITIAL_TIERS);
    const subtotal = 8000 * 2 + 60000 * 1;
    const serviceFee = feeA * 2 + feeB * 1;

    assert.equal(feeA, 500);
    assert.equal(feeB, 2000);
    assert.equal(subtotal, 76000);
    assert.equal(serviceFee, 3000);
    assert.equal(subtotal + serviceFee, 79000);

    // La trampa que la auditoría pidió evitar explícitamente: calcular la
    // comisión sobre el subtotal global (76000, que cae en el rango
    // [50000, null) -> $2000) da un resultado DISTINTO e incorrecto.
    const wrongGlobalFee = calculateServiceFeeForUnitPrice(subtotal, INITIAL_TIERS);
    assert.notEqual(wrongGlobalFee, serviceFee);
});

// ==================================================================
// validateServiceFeeTiersInput — todo lo que Developer > Configuración NO
// debe poder guardar.
// ==================================================================

test("the initial 4 tiers are valid as-is", () => {
    const { valid, errors } = validateServiceFeeTiersInput(INITIAL_TIERS);
    assert.equal(valid, true, JSON.stringify(errors));
});

test("an empty set is rejected", () => {
    const { valid, errors } = validateServiceFeeTiersInput([]);
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});

test("a negative minAmount is rejected", () => {
    const { valid } = validateServiceFeeTiersInput([{ minAmount: -100, maxAmount: null, feeAmount: 100 }]);
    assert.equal(valid, false);
});

test("a negative feeAmount is rejected", () => {
    const { valid } = validateServiceFeeTiersInput([{ minAmount: 0, maxAmount: null, feeAmount: -1 }]);
    assert.equal(valid, false);
});

test("an inverted range (min >= max) is rejected", () => {
    const { valid } = validateServiceFeeTiersInput([
        { minAmount: 5000, maxAmount: 1000, feeAmount: 100 },
        { minAmount: 0, maxAmount: null, feeAmount: 200 },
    ]);
    assert.equal(valid, false);
});

test("a gap between tiers is rejected", () => {
    const { valid, errors } = validateServiceFeeTiersInput([
        { minAmount: 0, maxAmount: 1000, feeAmount: 100 },
        { minAmount: 2000, maxAmount: null, feeAmount: 200 },
    ]);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.toLowerCase().includes("hueco")));
});

test("overlapping tiers are rejected", () => {
    const { valid, errors } = validateServiceFeeTiersInput([
        { minAmount: 0, maxAmount: 6000, feeAmount: 100 },
        { minAmount: 5000, maxAmount: null, feeAmount: 200 },
    ]);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.toLowerCase().includes("superposici")));
});

test("two open-ended tiers are rejected", () => {
    const { valid } = validateServiceFeeTiersInput([
        { minAmount: 0, maxAmount: null, feeAmount: 100 },
        { minAmount: 5000, maxAmount: null, feeAmount: 200 },
    ]);
    assert.equal(valid, false);
});

test("no open-ended tier at all is rejected (missing coverage for anything above the last limit)", () => {
    const { valid } = validateServiceFeeTiersInput([{ minAmount: 0, maxAmount: 5000, feeAmount: 100 }]);
    assert.equal(valid, false);
});

test("the open-ended tier must be the last one (highest minAmount), not in the middle", () => {
    const { valid } = validateServiceFeeTiersInput([
        { minAmount: 0, maxAmount: null, feeAmount: 100 },
        { minAmount: 5000, maxAmount: 10000, feeAmount: 200 },
    ]);
    assert.equal(valid, false);
});

test("the first tier must start exactly at $0", () => {
    const { valid } = validateServiceFeeTiersInput([{ minAmount: 100, maxAmount: null, feeAmount: 100 }]);
    assert.equal(valid, false);
});

test("valid tiers can be submitted out of order — the validator sorts them by minAmount before checking contiguity", () => {
    const { valid, sortedTiers } = validateServiceFeeTiersInput([
        { minAmount: 5000, maxAmount: 10000, feeAmount: 500 },
        { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
        { minAmount: 10000, maxAmount: null, feeAmount: 1000 },
    ]);
    assert.equal(valid, true);
    assert.equal(sortedTiers[0].minAmount, 0);
    assert.equal(sortedTiers[1].minAmount, 5000);
    assert.equal(sortedTiers[2].minAmount, 10000);
});
