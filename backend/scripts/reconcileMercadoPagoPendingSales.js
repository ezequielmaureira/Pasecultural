// Punto de entrada pensado para un futuro Render Cron Job — NO desplegado
// ni configurado en esta ronda (pedido explícito: primero validar
// manualmente la reconciliación, incluida la recuperación de la Sale real
// de producción que quedó PENDING, antes de habilitar el cron). Cuando se
// decida activarlo: Render Dashboard > New > Cron Job, mismo repo/build que
// el Web Service, comando `node scripts/reconcileMercadoPagoPendingSales.js`,
// frecuencia sugerida cada 10-15 minutos (ej. "*/10 * * * *") — el propio
// mecanismo (mercadoPagoPaymentId @unique + el guard atómico de
// confirmSaleService) hace que correrlo más o menos seguido nunca duplique
// nada, así que la frecuencia sólo afecta qué tan rápido se recupera un
// webhook perdido, nunca la seguridad. Necesita las mismas env vars que el
// Web Service (DATABASE_URL, MERCADOPAGO_*, MERCADOPAGO_TOKEN_SECRET_KEY,
// RESEND_API_KEY, EMAIL_FROM, MERCADOPAGO_RECONCILIATION_ALERT_EMAIL,
// DEVELOPER_ALERT_EMAIL) configuradas en el propio Cron Job de Render, no
// heredadas automáticamente del Web Service.
import "dotenv/config";
import { reconcilePendingMercadoPagoSalesService } from "../src/services/mercadoPagoReconciliation.service.js";

async function main() {
    const result = await reconcilePendingMercadoPagoSalesService();
    console.log("reconcilePendingMercadoPagoSalesService: completado", result);
}

main()
    .catch((err) => {
        console.error("reconcilePendingMercadoPagoSalesService: error inesperado", err);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
