import { round2 } from "../utils/money.js";

// MP-2 — ÚNICA fuente de verdad server-side de la comisión de PaseCultural.
// Regla de negocio inicial: 10% del precio final que paga el comprador
// (nunca se suma encima del total, se descuenta de él vía marketplace_fee
// — ver mercadoPagoCheckout.service.js). Ningún otro archivo repite "0.10"
// ni reimplementa este cálculo: controllers/servicios/tests que necesiten
// la comisión llaman a calculatePlatformFee(totalAmount).
//
// Deliberadamente una constante única y no configurable todavía (no hay
// planes comerciales, no hay porcentaje por Organization/evento en esta
// fase) — pero cada caller pasa siempre por esta función, nunca lee
// PLATFORM_FEE_PERCENTAGE directamente para calcular nada, así que el día
// que esto se vuelva una política real (por plan, por organización, etc.)
// sólo hace falta cambiar el cuerpo de calculatePlatformFee: ningún caller
// se reescribe.
export const PLATFORM_FEE_PERCENTAGE = 0.1;

export function calculatePlatformFee(totalAmount) {
    return round2(Number(totalAmount) * PLATFORM_FEE_PERCENTAGE);
}
