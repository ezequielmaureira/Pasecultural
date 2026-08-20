import { AppError } from "../errors/AppError.js";
import { logger } from "../logging/logger.js";
import { createMercadoPagoCheckoutService } from "../services/mercadoPagoCheckout.service.js";

// MP-2 — POST /api/sales/mercadopago/checkout. Público, sin sesión de
// Clerk (mismo criterio que createSale: el comprador siempre es
// invitado). Body: el mismo shape que createSale (firstName/lastName/
// email sueltos, no anidados) más `idempotencyKey` opcional — ver
// mercadoPagoCheckout.service.js para el resto del contrato. Nunca lee
// organizationId del body: la Organization se resuelve exclusivamente a
// partir del eventId, server-side.
export const createMercadoPagoCheckout = async (req, res, next) => {
    try {
        const {
            firstName,
            lastName,
            email,
            idempotencyKey,
            // Ronda de endurecimiento — lo que el comprador vio y
            // confirmó en SummaryStep. NUNCA autoritativo: se extraen acá
            // aparte, explícitamente, para que nunca terminen mezclados
            // dentro de `saleData` (que va tal cual a createGuestSaleService
            // como la selección de entradas/cantidades del comprador,
            // nunca precios). Ver createSaleForBuyer, sale.service.js —
            // es el único lugar que decide qué hacer con esto.
            confirmedTicketsSubtotal,
            confirmedServiceFee,
            confirmedTotal,
            ...saleData
        } = req.body;
        logger.info("createMercadoPagoCheckout controller entered", {
            firstName,
            lastName,
            email,
            saleData: { ...saleData, buyerDocument: saleData.buyerDocument ? "[present]" : undefined },
            hasIdempotencyKey: Boolean(idempotencyKey),
            hasConfirmedTotals: confirmedTotal !== undefined,
        });

        // Sólo se arma expectedTotals si el comprador mandó los tres
        // números — un envío parcial/malformado se trata como "no lo
        // mandó" (createSaleForBuyer ya valida con Number.isFinite antes
        // de comparar), nunca como un error de request.
        const expectedTotals =
            confirmedTicketsSubtotal !== undefined && confirmedServiceFee !== undefined && confirmedTotal !== undefined
                ? { ticketsSubtotal: confirmedTicketsSubtotal, serviceFee: confirmedServiceFee, total: confirmedTotal }
                : null;

        const result = await createMercadoPagoCheckoutService({ firstName, lastName, email }, saleData, idempotencyKey, expectedTotals);

        // result = { checkoutUrl, saleToken, ticketsSubtotal, serviceFee,
        // total } — nunca ningún dato de Mercado Pago más allá de la URL
        // de checkout pública.
        logger.info("createMercadoPagoCheckout controller completed", { hasCheckoutUrl: Boolean(result.checkoutUrl) });
        res.status(201).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
