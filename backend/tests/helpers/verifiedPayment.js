import { randomUUID } from "node:crypto";
import { createVerifiedMercadoPagoPaymentEvidence } from "../../src/services/paymentEvidence.js";

// Fixtures de tests con DB que necesitan una venta paga realmente CONFIRMED.
// confirmSaleService ya no confirma una venta paga sin evidencia de pago
// aprobado (ver sale.service.js#assertSaleConfirmationAuthorized): estos
// fixtures reproducen exactamente lo que hace
// mercadoPagoPaymentConfirmation.service.js después de verificar un payment
// approved contra Mercado Pago — la venta se crea con paymentMethod
// MERCADO_PAGO y se confirma con la evidencia correspondiente a su total.
export const VERIFIED_SALE_OPTIONS = Object.freeze({ paymentMethod: "MERCADO_PAGO" });

// Si la venta ya quedó vinculada a un payment (re-confirmación idempotente),
// la evidencia reusa ese mismo paymentId — igual que un webhook repetido.
export function verifiedPaymentEvidenceFor(sale, { source = "WEBHOOK" } = {}) {
    return createVerifiedMercadoPagoPaymentEvidence({
        paymentId: sale.mercadoPagoPaymentId ?? `test-pay-${randomUUID()}`,
        status: "approved",
        transactionAmount: Number(sale.total),
        currencyId: "ARS",
        source,
    });
}
