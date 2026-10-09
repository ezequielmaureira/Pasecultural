// Salida de Smarticket hacia Checkout Pro, compartida por PurchaseWizard y
// QuickPass. Se llama con el overlay de compra todavía abierto
// (usePublishFlow.run con keepPublishingOnSuccess): si hay URL, navega en la
// misma pestaña (nunca window.open ni iframe) y el overlay queda visible
// hasta que el navegador abandona la página. Sin URL no hay a dónde ir: se
// tira un error para que el llamador cierre el overlay y lo muestre.
export function redirectToCheckout(result, assign = (url) => window.location.assign(url)) {
  if (!result?.checkoutUrl) {
    throw new Error("No pudimos iniciar el pago con Mercado Pago. Intentá de nuevo.");
  }
  assign(result.checkoutUrl);
}
