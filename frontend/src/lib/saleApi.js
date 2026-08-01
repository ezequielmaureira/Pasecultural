import { apiFetch } from "./api.js";

// Sin token: el comprador nunca necesita sesión de Clerk para comprar.
// `buyer` es { firstName, lastName, email } — el backend lo resuelve como
// invitado (o reutiliza la cuenta si ese email ya existe).
export async function createSale({ eventId, functionId, items, buyer }) {
    const { sale } = await apiFetch("/api/sales", {
        method: "POST",
        body: JSON.stringify({ eventId, functionId, items, buyer }),
    });
    return sale;
}

// Confirmación de pago disparada por el propio flujo de compra — hoy es la
// única vía (pago manual/simulado), mañana la reemplaza el webhook de
// Mercado Pago sin que el Wizard tenga que saberlo (ver
// lib/payment/paymentGateway.js). Tampoco necesita sesión: se autoriza por
// conocer el saleId, que sólo este mismo navegador recibió al crearla.
export async function confirmSaleByBuyer(saleId) {
    return apiFetch(`/api/sales/${saleId}/confirm-by-buyer`, { method: "POST" });
}

// Público, sin sesión — sólo para la recuperación por timeout (ver
// checkPaymentOutcome en paymentGateway.js).
export async function getSaleStatus(saleId) {
    return apiFetch(`/api/sales/${saleId}/status`);
}
