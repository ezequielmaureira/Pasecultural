import { apiFetch, apiFetchBlob } from "./api.js";

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
// firstName/lastName/email/buyerDocument viajan sueltos en el body (no
// anidados bajo "buyer") — así es exactamente como los separa
// sale.controller.js del resto de los datos de la venta. El backend
// resuelve al comprador como invitado (o reutiliza la cuenta si ese email
// ya existe). buyerDocument es obligatorio (preparación para la futura
// recuperación segura de entradas — todavía no hay pantalla para eso, sólo
// se guarda). La respuesta trae `sale.publicRecoveryToken`: es lo único que
// el resto del Wizard usa para confirmar/consultar esta venta después —
// nunca `sale.id` (clave primaria interna, no pensada como secreto).
export async function createSale({ eventId, functionId, items, firstName, lastName, email, buyerDocument }) {
    const requestBody = { eventId, functionId, items, firstName, lastName, email, buyerDocument };
    // El DNI nunca se loguea completo, ni acá ni en el backend — sólo si vino.
    console.log("saleApi.createSale request body", { ...requestBody, buyerDocument: buyerDocument ? "[present]" : undefined });
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

// MP-2 — inicio real de una compra vía Mercado Pago (Checkout Pro + Split
// Payment 1:1). Mismo criterio sin sesión que createSale; mismo shape de
// body (firstName/lastName/email sueltos, buyerDocument) más
// `idempotencyKey` (generado una vez por intento de compra en
// PurchaseWizard, ver paymentGateway.js) para que un doble click o un
// reintento de red nunca terminen creando dos ventas ni dos preferencias.
// La respuesta { checkoutUrl, saleToken } nunca trae nada de Mercado Pago
// más allá de la URL pública de checkout — ni tokens, ni datos del
// organizador.
export async function createMercadoPagoCheckout({
    eventId,
    functionId,
    items,
    firstName,
    lastName,
    email,
    buyerDocument,
    idempotencyKey,
}) {
    const requestBody = { eventId, functionId, items, firstName, lastName, email, buyerDocument, idempotencyKey };
    console.log("saleApi.createMercadoPagoCheckout request body", {
        ...requestBody,
        buyerDocument: buyerDocument ? "[present]" : undefined,
    });
    const result = await apiFetch("/api/sales/mercadopago/checkout", {
        method: "POST",
        body: JSON.stringify(requestBody),
    });
    console.log("saleApi.createMercadoPagoCheckout response", { hasCheckoutUrl: Boolean(result?.checkoutUrl) });
    return result;
}

// Pantalla pública "Recuperar mis entradas", paso 1 — sin sesión. Email+DNI
// sólo LOCALIZAN una compra, nunca la revelan: la respuesta es siempre
// genérica (el email tipeado, enmascarado), exista o no una compra real
// detrás — nunca trae eventTitle/recoveryToken/tickets/QR acá. El DNI no se
// loguea completo, igual que en createSale.
export async function requestSaleRecoveryCode({ email, buyerDocument }) {
    console.log("saleApi.requestSaleRecoveryCode request", { email, buyerDocument: buyerDocument ? "[present]" : undefined });
    const { maskedEmail } = await apiFetch("/api/sales/recover", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument }),
    });
    return maskedEmail;
}

// Botón "Reenviar código" de la pantalla de verificación — mismo contrato
// genérico que requestSaleRecoveryCode.
export async function resendSaleRecoveryCode({ email, buyerDocument }) {
    const { maskedEmail } = await apiFetch("/api/sales/recover/resend", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument }),
    });
    return maskedEmail;
}

// Paso 2: código de 6 dígitos. Único punto de todo el flujo de recuperación
// que trae datos reales de compra (recoveryToken incluido) — recién
// después de un código correcto. maskedEmail viaja de nuevo acá para que la
// pantalla "Compra encontrada" lo muestre sin depender del estado del paso
// anterior.
export async function verifySaleRecoveryCode({ email, buyerDocument, code }) {
    const { sales, maskedEmail } = await apiFetch("/api/sales/recover/verify", {
        method: "POST",
        body: JSON.stringify({ email, buyerDocument, code }),
    });
    return { sales, maskedEmail };
}

// Botón "Reenviar correo" de la pantalla de recuperación — mismo modelo de
// autorización que confirmSaleByBuyer/getSaleStatus (conocer el
// recoveryToken alcanza). Nunca crea tickets ni una venta nueva, sólo
// reintenta el envío existente.
export async function resendSaleEmail(recoveryToken) {
    return apiFetch(`/api/sales/${recoveryToken}/resend-email`, { method: "POST" });
}

// Botón "Descargar PDF" de la pantalla "Compra encontrada" — mismo modelo
// de autorización que resendSaleEmail/getSaleStatus. Devuelve el mismo PDF
// completo que ya se adjunta al email de confirmación (ver
// getSalePdfByTokenService en el backend), como Blob listo para descargar.
export async function downloadSalePdf(recoveryToken) {
    return apiFetchBlob(`/api/sales/${recoveryToken}/pdf`);
}
