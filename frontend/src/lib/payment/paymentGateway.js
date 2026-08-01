import { createSale, confirmSaleByBuyer, listMySales } from "../saleApi.js";

// El Wizard de compra sólo conoce esta función — nunca los endpoints de
// Sale por dentro. Hoy "procesar el pago" significa crear la venta y
// confirmarla como comprador (pago manual/simulado, sin Mercado Pago
// todavía). El día que se integre Mercado Pago, esta es la ÚNICA función
// que cambia de implementación (createSale -> redirigir a MP Checkout ->
// esperar el webhook) — el Wizard sigue llamando a `processPayment` exacto
// igual, sin enterarse del cambio.
//
// `onSaleCreated` es opcional: le avisa al caller el id de la venta apenas
// se crea (antes de confirmar), para que `checkPaymentOutcome` pueda
// verificar exactamente ESA venta si `confirmSaleByBuyer` se cae por
// timeout — no sólo "alguna venta confirmada de este evento".
export async function processPayment(token, { eventId, functionId, items }, { onSaleCreated } = {}) {
    const sale = await createSale(token, { eventId, functionId, items });
    onSaleCreated?.(sale.id);
    return confirmSaleByBuyer(token, sale.id);
}

// Confirma, después de un timeout, si la compra se completó igual del lado
// del servidor — reutiliza GET /api/sales/mine (ya existe), no un endpoint
// nuevo. Prioriza el id exacto de la venta si se conoce; si no, cae a
// buscar cualquier venta confirmada de ese evento/función como mejor
// esfuerzo (createSale pudo no haber llegado a responder).
export async function checkPaymentOutcome(token, { eventId, functionId, saleId }) {
    const sales = await listMySales(token);

    if (saleId) {
        const exact = sales.find((sale) => sale.id === saleId && sale.status === "CONFIRMED");
        if (exact) return exact;
    }

    return (
        sales.find(
            (sale) => sale.event.id === eventId && sale.function.id === functionId && sale.status === "CONFIRMED"
        ) ?? null
    );
}
