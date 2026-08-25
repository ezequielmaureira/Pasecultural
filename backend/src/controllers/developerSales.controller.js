import { AppError } from "../errors/AppError.js";
import { listDeveloperSalesService, getDeveloperSaleService, getMercadoPagoSaleDiagnosticsService } from "../services/developerSales.service.js";
import { reconcileMercadoPagoSaleService } from "../services/mercadoPagoReconciliation.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta — misma
// convención que developerTickets.controller.js/developerScanners.controller.js.
// Platform-wide a propósito: ningún clerkId/organización que resolver acá,
// requireRole("DEVELOPER") ya alcanza (ver developerSales.routes.js).
export const listDeveloperSales = async (req, res, next) => {
    try {
        const { page, limit, search, organizationId, eventId, status, needsReconciliation } = req.query;
        const result = await listDeveloperSalesService({
            page,
            limit,
            search,
            organizationId,
            eventId,
            status,
            needsReconciliation: needsReconciliation === "true",
        });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getDeveloperSale = async (req, res, next) => {
    try {
        const sale = await getDeveloperSaleService(req.params.id);
        res.status(200).json({ sale });
    } catch (error) {
        next(AppError.from(error));
    }
};

// Herramienta de diagnóstico de Mercado Pago (sólo lectura) — ver
// getMercadoPagoSaleDiagnosticsService (developerSales.service.js).
export const getMercadoPagoSaleDiagnostics = async (req, res, next) => {
    try {
        const diagnostics = await getMercadoPagoSaleDiagnosticsService(req.params.id);
        res.status(200).json(diagnostics);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Reconciliación manual (ronda "recuperación de pagos") — sólo recibe
// `saleId` del path, NUNCA un status/paymentId del body/query: todo lo que
// de verdad decide si la venta se confirma sale de reconcileMercadoPagoSaleService,
// que siempre vuelve a consultar Mercado Pago server-to-server y pasa por
// las mismas validaciones que el webhook (núcleo compartido, ver
// mercadoPagoPaymentConfirmation.service.js). Nunca existe acá ni en el
// service ningún camino que permita "marcar CONFIRMED" o "crear Ticket" sin
// esa verificación real.
export const reconcileMercadoPagoSale = async (req, res, next) => {
    try {
        const outcome = await reconcileMercadoPagoSaleService(req.params.id, { source: "RECONCILIATION_MANUAL" });
        res.status(200).json(outcome);
    } catch (error) {
        next(AppError.from(error));
    }
};
