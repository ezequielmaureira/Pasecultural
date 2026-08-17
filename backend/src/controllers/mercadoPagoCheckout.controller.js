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
        const { firstName, lastName, email, idempotencyKey, ...saleData } = req.body;
        logger.info("createMercadoPagoCheckout controller entered", {
            firstName,
            lastName,
            email,
            saleData: { ...saleData, buyerDocument: saleData.buyerDocument ? "[present]" : undefined },
            hasIdempotencyKey: Boolean(idempotencyKey),
        });

        const result = await createMercadoPagoCheckoutService({ firstName, lastName, email }, saleData, idempotencyKey);

        // result = { checkoutUrl, saleToken } — nunca ningún dato de
        // Mercado Pago más allá de la URL de checkout pública.
        logger.info("createMercadoPagoCheckout controller completed", { hasCheckoutUrl: Boolean(result.checkoutUrl) });
        res.status(201).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
