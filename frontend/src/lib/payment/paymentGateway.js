import { createSale, confirmSaleByBuyer, getSaleStatus } from "../saleApi.js";

// El Wizard de compra sólo conoce esta función — nunca los endpoints de
// Sale por dentro, y nunca sesión de Clerk (el comprador es siempre
// invitado hoy). Hoy "procesar el pago" significa crear la venta y
// confirmarla (pago manual/simulado, sin Mercado Pago todavía). El día que
// se integre Mercado Pago, esta es la ÚNICA función que cambia de
// implementación (createSale -> redirigir a MP Checkout -> esperar el
// webhook) — el Wizard sigue llamando a `processPayment` exacto igual.
//
// `onSaleCreated` es opcional: le avisa al caller el id de la venta apenas
// se crea (antes de confirmar), para que `checkPaymentOutcome` pueda
// verificar exactamente ESA venta si `confirmSaleByBuyer` se cae por
// timeout.
export async function processPayment({ eventId, functionId, items, buyer }, { onSaleCreated } = {}) {
    const requestBody = {
        eventId,
        functionId,
        items,
        firstName: buyer?.firstName,
        lastName: buyer?.lastName,
        email: buyer?.email,
    };
    console.log("paymentGateway.processPayment before createSale", requestBody);
    const sale = await createSale(requestBody);
    console.log("paymentGateway.processPayment after createSale", { sale });
    onSaleCreated?.(sale.id);
    console.log("paymentGateway.processPayment before confirmSaleByBuyer", { saleId: sale.id });
    const result = await confirmSaleByBuyer(sale.id);
    console.log("paymentGateway.processPayment after confirmSaleByBuyer", { saleId: sale.id, result });
    return result;
}

// Confirma, después de un timeout, si la compra se completó igual del lado
// del servidor. Sin sesión no hay forma de listar "mis ventas" — por eso
// depende siempre de `saleId` (conocido porque este mismo navegador la
// creó); si por lo que sea ni eso se llegó a conocer (createSale() nunca
// respondió), no hay nada que verificar todavía.
//
// Cuando ya está CONFIRMED, /status trae también los tickets completos (ver
// getSaleStatusService) — así la pantalla de éxito se ve igual sin importar
// si el dato llegó directo de confirm-by-buyer o de esta recuperación.
export async function checkPaymentOutcome({ saleId }) {
    if (!saleId) return null;
    const { status, tickets } = await getSaleStatus(saleId);
    return status === "CONFIRMED" ? { id: saleId, status, tickets: tickets ?? [] } : null;
}
