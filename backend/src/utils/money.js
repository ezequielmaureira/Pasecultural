// Redondeo monetario único de todo el backend — extraído tal cual de
// sale.service.js (donde vivía privado, sin exportar) para que MP-2 pueda
// reusar EXACTAMENTE la misma aritmética al calcular la comisión de
// PaseCultural, en vez de introducir una segunda representación monetaria
// incompatible. Cero cambio de comportamiento: mismo Math.round(*100)/100
// de siempre, sólo movido a un lugar importable.
//
// Redondeo estándar a 2 decimales, mitad hacia arriba (Math.round: para
// montos siempre positivos como los de este dominio, .5 redondea hacia
// arriba) — compatible con lo que Mercado Pago espera en ARS (hasta 2
// decimales, ver items[].unit_price/marketplace_fee en la documentación
// oficial).
export function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}
