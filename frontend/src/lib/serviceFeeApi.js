import { apiFetch } from "./api.js";

// MP-6 — GET /api/sales/service-fee-tiers. Público, sin token: usado por
// el Wizard de compra para mostrar una ESTIMACIÓN de la comisión de
// servicio antes de pagar (ver SummaryStep.jsx y lib/serviceFee.js para
// el cálculo). El cálculo AUTORITATIVO final siempre lo hace el backend
// al crear el checkout — esto nunca es lo que termina cobrándose.
export async function getPublicServiceFeeTiers() {
    const { tiers } = await apiFetch("/api/sales/service-fee-tiers");
    return tiers;
}
