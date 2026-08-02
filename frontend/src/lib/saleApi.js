import { apiFetch } from "./api.js";

// `qrToken` (el secreto de cada entrada) y `publicRecoveryToken` (el bearer
// token de la venta) nunca deben volcarse tal cual a la consola del
// navegador: quedan en el historial de devtools y en cualquier herramienta
// que capture logs del cliente (Sentry, LogRocket, etc.). Los console.log
// de este módulo (y de los que consumen sus respuestas) pasan los objetos
// por acá antes de loguear.
export function redactTicketsForLog(tickets) {
    if (!Array.isArray(tickets)) return tickets;
    return tickets.map(({ qrToken, ...rest }) => rest);
}

export function redactSaleForLog(sale) {
    if (!sale) return sale;
    const { publicRecoveryToken, ...rest } = sale;
    return rest;
}

// Sin token: el comprador nunca necesita sesión de Clerk para comprar.
// firstName/lastName/email viajan sueltos en el body (no anidados bajo
// "buyer") — así es exactamente como los separa sale.controller.js del
// resto de los datos de la venta. El backend resuelve al comprador como
// invitado (o reutiliza la cuenta si ese email ya existe). La respuesta
// trae `sale.publicRecoveryToken`: es lo único que el resto del Wizard usa
// para confirmar/consultar esta venta después — nunca `sale.id` (clave
// primaria interna, no pensada como secreto).
export async function createSale({ eventId, functionId, items, firstName, lastName, email }) {
    const requestBody = { eventId, functionId, items, firstName, lastName, email };
    console.log("saleApi.createSale request body", requestBody);
    const { sale } = await apiFetch("/api/sales", {
        method: "POST",
        body: JSON.stringify(requestBody),
    });
    console.log("saleApi.createSale response", redactSaleForLog(sale));
    return sale;
}

// Confirmación de pago disparada por el propio flujo de compra — hoy es la
// única vía (pago manual/simulado), mañana la reemplaza el webhook de
// Mercado Pago sin que el Wizard tenga que saberlo (ver
// lib/payment/paymentGateway.js). Tampoco necesita sesión: se autoriza por
// conocer `recoveryToken` (Sale.publicRecoveryToken), que sólo este mismo
// navegador recibió al crearla.
export async function confirmSaleByBuyer(recoveryToken) {
    console.log("saleApi.confirmSaleByBuyer request recoveryToken present", Boolean(recoveryToken));
    const result = await apiFetch(`/api/sales/${recoveryToken}/confirm-by-buyer`, { method: "POST" });
    console.log("saleApi.confirmSaleByBuyer response", { ...result, tickets: redactTicketsForLog(result?.tickets) });
    return result;
}

// Público, sin sesión — para la recuperación por timeout (ver
// checkPaymentOutcome en paymentGateway.js) y para retomar una compra desde
// la URL después de una recarga (ver PurchaseWizard). Se resuelve por
// `recoveryToken`, igual que confirmSaleByBuyer.
export async function getSaleStatus(recoveryToken) {
    return apiFetch(`/api/sales/${recoveryToken}/status`);
}
