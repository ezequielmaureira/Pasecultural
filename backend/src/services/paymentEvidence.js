import { round2 } from "../utils/money.js";

// Evidencia de pago aprobado — lo ÚNICO que confirmSaleService acepta para
// pasar a CONFIRMED (y generar Tickets) una venta paga (origin SALE).
//
// La emite exclusivamente mercadoPagoPaymentConfirmation.service.js
// (webhook, reconciliación y recuperación del comprador), DESPUÉS de
// consultar el payment server-to-server en la API de Mercado Pago y de
// validar estado, monto, moneda, collector y organización. Nunca sale de un
// request: un objeto armado a partir de req.body/query/params (o un
// publicRecoveryToken/saleToken/externalReference) no está registrado en
// este WeakSet, y confirmSaleService lo rechaza aunque tenga los mismos
// campos.
const trustedEvidence = new WeakSet();

export const MERCADO_PAGO_CONFIRMATION_SOURCES = Object.freeze(
    new Set(["WEBHOOK", "RECONCILIATION_AUTO", "RECONCILIATION_MANUAL", "BUYER_RECOVERY"])
);

export function createVerifiedMercadoPagoPaymentEvidence({ paymentId, status, transactionAmount, currencyId, source }) {
    if (status !== "approved") {
        throw new Error("createVerifiedMercadoPagoPaymentEvidence: sólo un payment approved es evidencia de pago.");
    }
    if (!paymentId || !MERCADO_PAGO_CONFIRMATION_SOURCES.has(source)) {
        throw new Error("createVerifiedMercadoPagoPaymentEvidence: paymentId/source inválidos.");
    }
    const evidence = Object.freeze({
        provider: "MERCADO_PAGO",
        paymentId: String(paymentId),
        status,
        transactionAmount: round2(transactionAmount),
        currencyId,
        source,
    });
    trustedEvidence.add(evidence);
    return evidence;
}

export function isTrustedPaymentEvidence(evidence) {
    return typeof evidence === "object" && evidence !== null && trustedEvidence.has(evidence);
}
