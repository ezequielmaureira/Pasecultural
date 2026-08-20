import { AppError } from "../errors/AppError.js";
import { listDeveloperSalesService, getDeveloperSaleService, getMercadoPagoSaleDiagnosticsService } from "../services/developerSales.service.js";

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
