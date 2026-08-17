import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_FEE_PERCENTAGE, calculatePlatformFee } from "../src/config/platformFee.js";

// MP-2 — única fuente de verdad de la comisión de PaseCultural. Pura, sin
// DB: no hace falta Prisma para probar aritmética.

test("PLATFORM_FEE_PERCENTAGE is exactly 10%", () => {
    assert.equal(PLATFORM_FEE_PERCENTAGE, 0.1);
});

// $10.000 -> $1.000 (caso obligatorio del pedido).
test("calculatePlatformFee: $10.000 -> $1.000", () => {
    assert.equal(calculatePlatformFee(10000), 1000);
});

// $15.000 -> $1.500 (caso obligatorio del pedido).
test("calculatePlatformFee: $15.000 -> $1.500", () => {
    assert.equal(calculatePlatformFee(15000), 1500);
});

// Redondeo: 33.35 * 0.10 = 3.335 -> redondea a 3.34 (mitad hacia arriba,
// 2 decimales — mismo criterio que round2/sale.service.js, compatible con
// lo que Mercado Pago acepta en ARS).
test("calculatePlatformFee: rounds half-up to 2 decimals (33.35 -> 3.34)", () => {
    assert.equal(calculatePlatformFee(33.35), 3.34);
});

// Otro caso de redondeo, en el otro sentido (trunca hacia abajo cuando el
// tercer decimal es < 5): 9.99 * 0.10 = 0.999 -> 1.00 (sube), vs 9.94 *
// 0.10 = 0.994 -> 0.99 (baja) — confirma que no siempre redondea para
// arriba, depende del tercer decimal real.
test("calculatePlatformFee: 9.99 -> 1.00 (sube), 9.94 -> 0.99 (baja)", () => {
    assert.equal(calculatePlatformFee(9.99), 1);
    assert.equal(calculatePlatformFee(9.94), 0.99);
});

// El total nunca es un Number nativo en el resto del código (Prisma
// Decimal) — calculatePlatformFee tiene que aceptar ese tipo igual.
test("calculatePlatformFee accepts values coerced from strings/Decimal-like objects", () => {
    assert.equal(calculatePlatformFee("10000.00"), 1000);
    assert.equal(calculatePlatformFee({ toString: () => "15000" }), 1500);
});
