import { createMercadoPagoCheckout } from "../saleApi.js";

// El Wizard de compra sólo conoce esta función — nunca los endpoints por
// dentro. MP-2: "procesar el pago" ahora significa crear el checkout de
// Mercado Pago (Sale PENDING + preferencia de Checkout Pro con Split
// Payment) y devolver la URL a la que el navegador tiene que navegar —
// nunca confirma la compra acá, nunca hay tickets todavía. La
// confirmación real llega en MP-3, server-to-server, vía webhook de
// Mercado Pago (nunca desde este flujo ni desde el redirect del
// comprador) — ver el informe de entrega de MP-2.
//
// `idempotencyKey`: generado UNA vez por intento de compra en
// PurchaseWizard (no por request) — el backend es idempotente para esa
// clave, así que reintentarla (doble click, timeout de usePublishFlow,
// reintento de red) nunca crea una segunda venta ni una segunda
// preferencia.
export async function processPayment({ eventId, functionId, items, buyer }, { idempotencyKey } = {}) {
    const requestBody = {
        eventId,
        functionId,
        items,
        firstName: buyer?.firstName,
        lastName: buyer?.lastName,
        email: buyer?.email,
        buyerDocument: buyer?.document,
        idempotencyKey,
    };
    console.log("paymentGateway.processPayment before createMercadoPagoCheckout", {
        ...requestBody,
        buyerDocument: requestBody.buyerDocument ? "[present]" : undefined,
    });
    const result = await createMercadoPagoCheckout(requestBody);
    console.log("paymentGateway.processPayment after createMercadoPagoCheckout", {
        hasCheckoutUrl: Boolean(result?.checkoutUrl),
    });
    return result; // { checkoutUrl, saleToken }
}
