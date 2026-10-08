import { apiFetch } from "./api.js";

// MP-6 — GET/PUT /api/developer/service-fee. Exclusivo DEVELOPER (ver
// backend/src/routes/developerServiceFee.routes.js).
export async function getServiceFeeConfig(token) {
    return apiFetch("/api/developer/service-fee", { token });
}

// tiers: [{ minAmount, maxAmount, feeAmount }] — reemplaza el conjunto
// COMPLETO de forma atómica (ver replaceServiceFeeTiers, serviceFee.service.js).
export async function updateServiceFeeConfig(token, tiers) {
    return apiFetch("/api/developer/service-fee", {
        token,
        method: "PUT",
        body: JSON.stringify({ tiers }),
    });
}

// GET/PUT /api/developer/service-fee/buyer-benefit — duración del beneficio
// inicial para compradores, en meses (0 = desactivado, máximo 12).
export async function getBuyerBenefitConfig(token) {
  return apiFetch("/api/developer/service-fee/buyer-benefit", { token });
}

export async function updateBuyerBenefitConfig(token, serviceFeeWaiverDurationMonths) {
  return apiFetch("/api/developer/service-fee/buyer-benefit", {
    token,
    method: "PUT",
    body: JSON.stringify({ serviceFeeWaiverDurationMonths }),
  });
}
