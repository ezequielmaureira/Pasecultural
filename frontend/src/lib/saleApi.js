import { apiFetch } from "./api.js";

// Sin token: el comprador nunca necesita sesión de Clerk para comprar.
// firstName/lastName/email viajan sueltos en el body (no anidados bajo
// "buyer") — así es exactamente como los separa sale.controller.js del
// resto de los datos de la venta. El backend resuelve al comprador como
// invitado (o reutiliza la cuenta si ese email ya existe).
export async function createSale({ eventId, functionId, items, firstName, lastName, email }) {
    const requestBody = { eventId, functionId, items, firstName, lastName, email };
    console.log("saleApi.createSale request body", requestBody);
    const { sale } = await apiFetch("/api/sales", {
        method: "POST",
        body: JSON.stringify(requestBody),
    });
    console.log("saleApi.createSale response", sale);
    return sale;
}

// Confirmación de pago disparada por el propio flujo de compra — hoy es la
// única vía (pago manual/simulado), mañana la reemplaza el webhook de
// Mercado Pago sin que el Wizard tenga que saberlo (ver
// lib/payment/paymentGateway.js). Tampoco necesita sesión: se autoriza por
// conocer el saleId, que sólo este mismo navegador recibió al crearla.
export async function confirmSaleByBuyer(saleId) {
    console.log("saleApi.confirmSaleByBuyer request saleId", saleId);
    const result = await apiFetch(`/api/sales/${saleId}/confirm-by-buyer`, { method: "POST" });
    console.log("saleApi.confirmSaleByBuyer response", result);
    return result;
}

// Público, sin sesión — sólo para la recuperación por timeout (ver
// checkPaymentOutcome en paymentGateway.js).
export async function getSaleStatus(saleId) {
    return apiFetch(`/api/sales/${saleId}/status`);
}
