import { apiFetch } from "./api.js";

export async function createSale(token, { eventId, functionId, items }) {
    const { sale } = await apiFetch("/api/sales", {
        token,
        method: "POST",
        body: JSON.stringify({ eventId, functionId, items }),
    });
    return sale;
}

// Confirmación de pago disparada por el propio comprador — hoy es la única
// vía (pago manual/simulado), mañana la reemplaza el webhook de Mercado
// Pago sin que el Wizard tenga que saberlo (ver lib/payment/paymentGateway.js).
export async function confirmSaleByBuyer(token, saleId) {
    return apiFetch(`/api/sales/${saleId}/confirm-by-buyer`, { token, method: "POST" });
}

export async function listMySales(token) {
    const { sales } = await apiFetch("/api/sales/mine", { token });
    return sales;
}
