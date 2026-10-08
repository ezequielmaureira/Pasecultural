import { estimateBuyerServiceFeeUnit } from "./serviceFee.js";

// Simulador público de /costos-y-comisiones. Cálculo PURO e informativo:
// el cargo sale de estimateBuyerServiceFeeUnit (la misma función que usan
// el Wizard de compra y Quick Pass: $0 con beneficio activo, si no el
// espejo de calculateServiceFeeForUnitPrice) aplicado a la escala real de
// GET /api/sales/service-fee-tiers.
// Nunca decide lo que se cobra: eso lo sigue haciendo el backend.

// Hasta 9 dígitos (< $1.000.000.000): suficiente para cualquier entrada y
// evita montos que dejan de ser legibles en una card de celular.
export const MAX_PRICE_DIGITS = 9;

// Texto del input → solo dígitos en pesos enteros. Ignora decimales
// pegados ("25.000,50" → "25000"), signos y letras; nunca negativo.
export function sanitizePriceInput(raw) {
  const integerPart = String(raw ?? "").split(",")[0];
  return integerPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_PRICE_DIGITS);
}

export function formatPriceInput(digits) {
  return digits === "" ? "" : Number(digits).toLocaleString("es-AR");
}

// benefitActive: el organizador tiene el beneficio para compradores activo
// → cargo Smarticket $0. La comisión al organizador es SIEMPRE $0.
// Devuelve null si todavía no hay precio; feeAvailable=false si hace falta
// la escala y no se pudo cargar (nunca se inventa un cargo).
export function simulatePurchase({ digits, benefitActive, tiers }) {
  if (digits === "") return null;
  const price = Number(digits);
  const organizerCommission = 0;

  if (benefitActive || price === 0) {
    return { price, organizerCommission, serviceFee: 0, total: price, feeAvailable: true, isFree: price === 0 };
  }
  if (!tiers?.length) {
    return { price, organizerCommission, serviceFee: null, total: null, feeAvailable: false, isFree: false };
  }
  const serviceFee = estimateBuyerServiceFeeUnit(price, tiers, { serviceFeeWaived: false });
  return { price, organizerCommission, serviceFee, total: price + serviceFee, feeAvailable: true, isFree: false };
}
