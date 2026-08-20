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
