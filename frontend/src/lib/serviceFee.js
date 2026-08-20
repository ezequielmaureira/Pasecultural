// MP-6 — cálculo PURO, sólo para mostrar una ESTIMACIÓN en el Wizard de
// compra (ver SummaryStep.jsx). Espejo intencional de
// calculateServiceFeeForUnitPrice (backend/src/services/serviceFee.service.js)
// — el backend es la única fuente autoritativa; esto nunca decide cuánto
// se cobra de verdad, sólo lo anticipa antes de llegar al checkout.
export function estimateServiceFeeForUnitPrice(unitPrice, tiers) {
  const price = Math.round(Number(unitPrice) * 100) / 100;
  if (!(price > 0)) return 0;

  const tier = (tiers ?? []).find((t) => {
    const min = Number(t.minAmount);
    const max = t.maxAmount == null ? null : Number(t.maxAmount);
    return price >= min && (max === null || price < max);
  });

  // Sin rango que cubra este precio (config todavía no cargó, o está
  // incompleta) — nunca se inventa un número: 0 acá sólo afecta la
  // ESTIMACIÓN visual, el backend igual va a fallar explícito al crear el
  // checkout si de verdad no hay configuración válida (SERVICE_FEE_CONFIG_MISSING).
  return tier ? Math.round(Number(tier.feeAmount) * 100) / 100 : 0;
}
