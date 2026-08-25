import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { searchMercadoPagoMerchantOrdersByPreferenceId, searchMercadoPagoPaymentsByExternalReference } from "./mercadoPago.service.js";
import { getValidMercadoPagoAccessTokenForConnection } from "./mercadoPagoConnection.service.js";
import { confirmMercadoPagoPaymentIfEligible } from "./mercadoPagoPaymentConfirmation.service.js";
import { sendDeveloperAlert, DeveloperAlertType } from "./email/sendDeveloperAlert.service.js";

// Reconciliación de pagos — recupera Sales PENDING de Mercado Pago cuyo
// pago fue realmente APROBADO pero cuyo webhook nunca llegó a procesarse
// (firma inválida, caída transitoria, credencial mal configurada, etc.).
// NUNCA confía en frontend/redirect/parámetros del comprador — siempre
// descubre el payment consultando directamente a Mercado Pago, y SIEMPRE
// termina delegando la validación/confirmación real a
// confirmMercadoPagoPaymentIfEligible (mercadoPagoPaymentConfirmation.
// service.js) — el mismo núcleo que usa el webhook. Cero lógica financiera
// propia de este archivo: sólo descubrimiento (qué paymentId probar) y
// orquestación (a qué Sales aplicarlo, cuándo).
//
// Verificado contra la documentación oficial vigente de Mercado Pago (MCP,
// antes de esta implementación): GET /merchant_orders/search?preference_id=
// devuelve, por Checkout Pro, cada merchant_order asociada a una
// preferencia con su propio array `payments` (cada intento de pago sobre
// esa preferencia, con su status) — es el mecanismo NATIVO de Checkout Pro
// para enumerar todos los intentos de una preferencia, nunca asumir que el
// primero es el correcto. GET /v1/payments/search?external_reference=...
// (con status=approved como filtro adicional) es la segunda fuente,
// documentada de forma independiente, usada como refuerzo/fallback. Ninguna
// de las dos se usa como fuente de verdad financiera: sólo para PROPONER
// candidatos — la verificación real siempre vuelve a pasar por
// GET /v1/payments/{id} dentro de confirmMercadoPagoPaymentIfEligible.

// Margen sobre STOCK_RESERVATION_TTL_MS (15 min, sale.service.js): una Sale
// candidata a reconciliación automática debe tener su reserva YA vencida
// hace al menos este margen — nunca se reconcilia una Sale todavía dentro
// de su ventana normal de pago (podría estar genuinamente en curso, y el
// webhook normal todavía puede llegar a tiempo). Una Sale con `paymentRef`
// ya seteado (caso INSUFFICIENT_STOCK detectado por el webhook) es
// candidata SIEMPRE, sin importar la reserva: ese caso ya sabemos que el
// webhook terminó de procesarla y no va a reintentar solo (Mercado Pago
// considera esa notificación resuelta, HTTP 200).
const RECONCILIATION_GRACE_MS = 5 * 60 * 1000;

function extractApprovedPaymentIds({ merchantOrderResult, paymentsSearchResult }) {
    const approvedIds = new Set();
    if (merchantOrderResult?.success) {
        for (const order of merchantOrderResult.merchantOrders) {
            for (const payment of order.payments ?? []) {
                if (payment?.status === "approved" && payment.id) approvedIds.add(payment.id);
            }
        }
    }
    if (paymentsSearchResult?.success) {
        for (const payment of paymentsSearchResult.payments) {
            if (payment?.status === "approved" && payment.id) approvedIds.add(payment.id);
        }
    }
    return [...approvedIds];
}

// Conexiones candidatas de una Organization, ACTIVE primero y después
// DISCONNECTED (más reciente primero) — mismo problema que ya resolvió el
// webhook (bug fix "desconexión de Mercado Pago"): si la Organization
// desconectó la cuenta que hizo el pago original y conectó otra, la ACTIVE
// actual ya no sirve para encontrarlo.
async function listCandidateConnectionsForOrganization(organizationId) {
    const [active, disconnected] = await Promise.all([
        prisma.mercadoPagoConnection.findMany({ where: { organizationId, status: "ACTIVE" } }),
        prisma.mercadoPagoConnection.findMany({ where: { organizationId, status: "DISCONNECTED" }, orderBy: { connectedAt: "desc" } }),
    ]);
    return [...active, ...disconnected];
}

// Prueba las conexiones candidatas de la Organization dueña del evento. Los
// resultados de búsqueda de Mercado Pago ya vienen scoped a la cuenta del
// token usado — nunca puede aparecer un payment de otra cuenta acá, así que
// alcanza con quedarse en la primera conexión que encuentre algo.
async function discoverApprovedMercadoPagoPaymentForSale(sale) {
    const candidateConnections = await listCandidateConnectionsForOrganization(sale.event.organizationId);

    for (const connection of candidateConnections) {
        let accessToken;
        try {
            accessToken = await getValidMercadoPagoAccessTokenForConnection(connection.id);
        } catch (error) {
            logger.warn("mercadopago reconciliation: no se pudo obtener credencial para intentar descubrir el payment con esta conexión", {
                saleId: sale.id,
                connectionId: connection.id,
                connectionStatus: connection.status,
                reason: error?.code ?? error?.message ?? "UNKNOWN",
            });
            continue;
        }

        const [merchantOrderResult, paymentsSearchResult] = await Promise.all([
            sale.mercadoPagoPreferenceId
                ? searchMercadoPagoMerchantOrdersByPreferenceId({ accessToken, preferenceId: sale.mercadoPagoPreferenceId })
                : Promise.resolve({ success: false, error: "NO_PREFERENCE_ID" }),
            sale.mercadoPagoExternalReference
                ? searchMercadoPagoPaymentsByExternalReference({ accessToken, externalReference: sale.mercadoPagoExternalReference })
                : Promise.resolve({ success: false, error: "NO_EXTERNAL_REFERENCE" }),
        ]);

        const approvedPaymentIds = extractApprovedPaymentIds({ merchantOrderResult, paymentsSearchResult });
        if (approvedPaymentIds.length > 0) {
            return { connectionId: connection.id, approvedPaymentIds };
        }
    }

    return { connectionId: null, approvedPaymentIds: [] };
}

// Reconcilia UNA Sale puntual — usado tanto por el sweep automático (una
// vez por candidata) como por el endpoint manual DEVELOPER (una Sale a la
// vez). Nunca acepta paymentId/status del caller: todo sale de acá adentro
// o de Mercado Pago.
export async function reconcileMercadoPagoSaleService(saleId, { source = "RECONCILIATION_MANUAL" } = {}) {
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: {
            id: true,
            eventId: true,
            status: true,
            paymentMethod: true,
            mercadoPagoPreferenceId: true,
            mercadoPagoExternalReference: true,
            mercadoPagoPaymentId: true,
            paymentRef: true,
            event: { select: { organizationId: true } },
        },
    });
    if (!sale) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    if (sale.paymentMethod !== "MERCADO_PAGO") {
        return { ok: true, action: "not_applicable", saleId, reason: "NOT_MERCADOPAGO_SALE" };
    }

    // Ya vinculada a un payment (confirmada, o una carrera con el webhook
    // que ya ganó) — nunca hace falta descubrir nada, se re-verifica ese
    // mismo payment directamente. Idempotente: confirmMercadoPagoPaymentIfEligible
    // ya sabe devolver "already_confirmed" sin duplicar nada.
    if (sale.mercadoPagoPaymentId) {
        return confirmMercadoPagoPaymentIfEligible({ paymentId: sale.mercadoPagoPaymentId, candidateConnectionId: null, source });
    }

    if (sale.status !== "PENDING") {
        // CONFIRMED sin mercadoPagoPaymentId no debería poder pasar para
        // MERCADO_PAGO (confirmSaleService siempre lo persiste en la misma
        // transacción); CANCELLED/EXPIRED simplemente ya no son
        // reconciliables. En cualquier caso, nada que hacer acá.
        return { ok: true, action: "not_applicable", saleId, reason: `SALE_STATUS_${sale.status}` };
    }

    // Caso ya detectado por el webhook (INSUFFICIENT_STOCK): el paymentId
    // ya se conoce por `paymentRef`, sin necesidad de buscar de nuevo — se
    // reintenta directamente. Bug encontrado en esta misma ronda (tests):
    // este payment NUNCA llegó a vincularse (mercadoPagoPaymentId sigue
    // null — esa es justamente la definición de INSUFFICIENT_STOCK), así
    // que `alreadyLinked` dentro de confirmMercadoPagoPaymentIfEligible
    // tampoco va a resolver nada — hace falta proponer un candidato real
    // acá, nunca null. Si el stock se liberó mientras tanto, confirma; si
    // sigue sin stock, vuelve a caer en approved_but_no_stock sin efectos
    // adicionales (misma alerta con idempotencyKey fija).
    if (sale.paymentRef) {
        const candidateConnections = await listCandidateConnectionsForOrganization(sale.event.organizationId);
        return confirmMercadoPagoPaymentIfEligible({
            paymentId: sale.paymentRef,
            candidateConnectionId: candidateConnections[0]?.id ?? null,
            source,
        });
    }

    if (!sale.mercadoPagoPreferenceId && !sale.mercadoPagoExternalReference) {
        return { ok: true, action: "no_approved_payment_found", saleId, reason: "NO_MERCADOPAGO_IDENTIFIERS" };
    }

    const { connectionId, approvedPaymentIds } = await discoverApprovedMercadoPagoPaymentForSale(sale);

    if (approvedPaymentIds.length === 0) {
        logger.info("mercadopago reconciliation: no se encontró ningún payment approved para esta Sale", { saleId, source });
        return { ok: true, action: "no_approved_payment_found", saleId };
    }

    if (approvedPaymentIds.length > 1) {
        // Más de un payment approved para la MISMA Sale/preferencia — nunca
        // se asume cuál es el correcto (pedido explícito de esta ronda).
        // Nunca se confirma automáticamente: requiere intervención manual.
        logger.error(new Error("mercadopago reconciliation: se encontraron múltiples payments approved para la misma Sale — ambigüedad, requiere intervención manual"), {
            saleId,
            source,
            candidateCount: approvedPaymentIds.length,
            candidatePaymentIds: approvedPaymentIds,
        });
        const alertResult = await sendDeveloperAlert(DeveloperAlertType.FINANCIAL_INVARIANT_BROKEN, {
            reason: "AMBIGUOUS_APPROVED_PAYMENTS",
            saleId,
            eventId: sale.eventId,
            organizationId: sale.event.organizationId,
            detail: `Se encontraron ${approvedPaymentIds.length} payments approved distintos para la misma Sale: ${approvedPaymentIds.join(", ")}`,
        });
        if (!alertResult.sent) {
            logger.error(new Error("mercadopago reconciliation: no se pudo enviar la alerta de ambigüedad"), { saleId, reason: alertResult.reason });
        }
        return { ok: true, action: "ambiguous_approved_payments", saleId, candidateCount: approvedPaymentIds.length };
    }

    return confirmMercadoPagoPaymentIfEligible({ paymentId: approvedPaymentIds[0], candidateConnectionId: connectionId, source });
}

// Candidatas al sweep automático — status=PENDING, MERCADO_PAGO, sin
// mercadoPagoPaymentId todavía, y (a) ya marcada `paymentRef` por el
// webhook (INSUFFICIENT_STOCK, nunca se resuelve sola) o (b) con la reserva
// de stock vencida hace más del margen de seguridad (nunca se toca una
// compra todavía en curso).
export async function findMercadoPagoReconciliationCandidateSaleIds() {
    const cutoff = new Date(Date.now() - RECONCILIATION_GRACE_MS);
    const sales = await prisma.sale.findMany({
        where: {
            status: "PENDING",
            paymentMethod: "MERCADO_PAGO",
            mercadoPagoPaymentId: null,
            OR: [{ paymentRef: { not: null } }, { mercadoPagoPreferenceId: { not: null }, stockReservedUntil: { lt: cutoff } }],
        },
        select: { id: true },
    });
    return sales.map((sale) => sale.id);
}

// Sweep completo — pensado para un futuro Render Cron Job (ver
// backend/scripts/reconcileMercadoPagoPendingSales.js), NO configurado
// todavía en esta ronda. Un fallo reconciliando una Sale puntual nunca
// interrumpe el resto del sweep.
export async function reconcilePendingMercadoPagoSalesService() {
    const saleIds = await findMercadoPagoReconciliationCandidateSaleIds();
    const results = [];
    for (const saleId of saleIds) {
        try {
            const outcome = await reconcileMercadoPagoSaleService(saleId, { source: "RECONCILIATION_AUTO" });
            results.push({ saleId, ...outcome });
        } catch (error) {
            logger.error(error, {
                context: "mercadopago reconciliation: fallo inesperado reconciliando una Sale candidata (no interrumpe el resto del sweep)",
                saleId,
            });
            results.push({ saleId, ok: false, action: "error", reason: error?.code ?? error?.message ?? "UNKNOWN" });
        }
    }

    const summary = {
        candidateCount: saleIds.length,
        confirmed: results.filter((r) => r.action === "confirmed").length,
        alreadyConfirmed: results.filter((r) => r.action === "already_confirmed").length,
        noApprovedPaymentFound: results.filter((r) => r.action === "no_approved_payment_found").length,
        approvedButNoStock: results.filter((r) => r.action === "approved_but_no_stock").length,
        ambiguous: results.filter((r) => r.action === "ambiguous_approved_payments").length,
        errors: results.filter((r) => r.ok === false).length,
    };
    logger.info("mercadopago reconciliation: sweep completado", summary);
    return { ...summary, results };
}
