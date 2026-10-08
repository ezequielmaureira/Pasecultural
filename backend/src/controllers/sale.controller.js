import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    cancelSaleService,
    listSalesOrganizerService,
    listSalesBuyerService,
    getSaleStatusService,
    resendConfirmationEmailByTokenService,
    getSalePdfByTokenService,
} from "../services/sale.service.js";
import { getActiveServiceFeeTiers, computeServiceFeeTiersVersion } from "../services/serviceFee.service.js";
import { getServiceFeeWaiverDurationMonths } from "../services/serviceFeeWaiver.service.js";
import { resendSaleConfirmationEmailService } from "../services/email/sendSaleConfirmationEmail.service.js";
import {
    requestSaleRecoveryCodeService,
    resendSaleRecoveryCodeService,
    verifySaleRecoveryCodeService,
} from "../services/saleRecoveryVerification.service.js";
import {
    requestPaymentRecoveryCodeService,
    resendPaymentRecoveryCodeService,
    verifyPaymentRecoveryCodeService,
} from "../services/mercadoPagoBuyerRecovery.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta. Toda la
// validación de negocio vive en sale.service.js — acá no hay ningún if de
// reglas de dominio.

export const cancelSale = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const sale = await cancelSaleService(userId, req.params.id);
        res.status(200).json({ sale });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listSalesOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { status, eventId, dateFrom, dateTo, buyer } = req.query;
        const sales = await listSalesOrganizerService(userId, { status, eventId, dateFrom, dateTo, buyer });
        res.status(200).json({ sales });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listSalesBuyer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const sales = await listSalesBuyerService(userId);
        res.status(200).json({ sales });
    } catch (error) {
        next(AppError.from(error));
    }
};

// Público, sin sesión: sólo el status de una venta puntual por
// publicRecoveryToken — nada de datos del comprador. Es lo único que
// necesita la recuperación por timeout del Wizard invitado (no puede usar
// GET /sales/mine sin sesión).
export const getSaleStatus = async (req, res, next) => {
    try {
        const status = await getSaleStatusService(req.params.token);
        res.status(200).json(status);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Reintento administrativo del email de confirmación — DEVELOPER, o el
// ORGANIZER dueño del evento de esa venta (verificado dentro del service).
// Nunca acepta un email del body: siempre manda al buyerEmail ya guardado
// en la venta. No es un endpoint público ni de uso masivo — sólo por id
// interno, autenticado.
export const resendSaleConfirmationEmail = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await resendSaleConfirmationEmailService(userId, req.params.id);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Pantalla pública "Recuperar mis entradas", paso 1 — sin sesión. Email+DNI
// sólo LOCALIZAN una compra, nunca la revelan: la respuesta es
// { matched, maskedEmail } — matched dice si la COMBINACIÓN tiene una compra
// vigente recuperable, nunca cuál campo falló — ver
// saleRecoveryVerification.service.js. Si hay match, dispara el código de 6
// dígitos por email; nunca devuelve tickets, QR ni ningún otro dato de la
// compra.
export const requestSaleRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await requestSaleRecoveryCodeService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Botón "Reenviar código" de la pantalla de verificación — mismo contrato
// genérico que el paso 1.
export const resendSaleRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await resendSaleRecoveryCodeService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Paso 2 — único punto de todo el flujo que devuelve datos de una compra
// (evento/fecha/lugar/token), y sólo después de un código de 6 dígitos
// correcto. El detalle completo con QR se sigue pidiendo después por
// publicRecoveryToken, reusando GET /sales/:token/status — nunca duplicado
// acá.
export const verifySaleRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument, code } = req.body;
        const result = await verifySaleRecoveryCodeService({ email, buyerDocument, code });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// "Pagué pero no recibí mis entradas" (ronda "recuperación de pagos", parte
// 2), paso 1 — mismo contrato genérico que requestSaleRecoveryCode. El
// paymentId NUNCA se lee ni se usa acá (recién importa en el paso 2, ver
// verifyPaymentRecoveryCode) — nunca se persiste entre pasos.
export const requestPaymentRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await requestPaymentRecoveryCodeService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendPaymentRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument } = req.body;
        const result = await resendPaymentRecoveryCodeService({ email, buyerDocument });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Paso 2 — único punto que realmente consulta/reconcilia/confirma/reenvía
// una compra de Mercado Pago a partir del paymentId, y SOLO después de un
// código OTP correcto (ver verifyPaymentRecoveryCodeService). La respuesta
// { matched: false } es una respuesta pública NORMAL (200), no un error —
// mismo criterio que "sales: []" en verifySaleRecoveryCode; un rate limit
// excedido sigue devolviendo 429 (middleware), y una falla real de
// Mercado Pago/infraestructura sigue propagando su propio código HTTP (ver
// MERCADOPAGO_RECOVERY_CHECK_FAILED, 502) — nunca se fuerza 200 para todo.
export const verifyPaymentRecoveryCode = async (req, res, next) => {
    try {
        const { email, buyerDocument, code, paymentId } = req.body;
        const result = await verifyPaymentRecoveryCodeService({ email, buyerDocument, code, paymentId });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Botón "Reenviar correo" en la pantalla de recuperación — sin sesión,
// autorizado por publicRecoveryToken (mismo modelo que confirm-by-buyer y
// status). Nunca acepta un email del body.
export const resendSaleEmailByToken = async (req, res, next) => {
    try {
        const result = await resendConfirmationEmailByTokenService(req.params.token);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

// Botón "Descargar PDF" de la pantalla "Compra encontrada" — sin sesión,
// autorizado por publicRecoveryToken (mismo modelo que confirm-by-buyer,
// status y resend-email). A diferencia del resto de los endpoints de este
// archivo, la respuesta no es JSON: es el PDF binario tal cual, con
// Content-Disposition para que el navegador lo descargue directo.
export const getSalePdfByToken = async (req, res, next) => {
    try {
        const { pdfBuffer, fileName } = await getSalePdfByTokenService(req.params.token);
        res.status(200);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);
    } catch (error) {
        next(AppError.from(error));
    }
};

// MP-6 — GET /api/sales/service-fee-tiers. Público, sin sesión: es lo que
// el Wizard de compra usa para mostrar una ESTIMACIÓN de la comisión de
// servicio antes de pagar (ver SummaryStep.jsx) — el cálculo AUTORITATIVO
// sigue ocurriendo exclusivamente server-side al crear el checkout (ver
// createSaleForBuyer, sale.service.js). No es información sensible: son
// las mismas reglas que ya se le aplican a cualquier comprador, nunca un
// dato personal ni una credencial. Shape mínimo a propósito (sin id/
// updatedAt/updatedByUserId, eso es sólo para Developer > Configuración).
export const getPublicServiceFeeTiers = async (req, res, next) => {
    try {
        const [tiers, serviceFeeWaiverDurationMonths] = await Promise.all([
            getActiveServiceFeeTiers(),
            getServiceFeeWaiverDurationMonths(),
        ]);
        res.status(200).json({
            tiers: tiers.map((tier) => ({
                minAmount: Number(tier.minAmount),
                maxAmount: tier.maxAmount == null ? null : Number(tier.maxAmount),
                feeAmount: Number(tier.feeAmount),
            })),
            // Ronda de endurecimiento — hash de contenido, sólo diagnóstico/
            // uso futuro (ver computeServiceFeeTiersVersion,
            // serviceFee.service.js). La protección real del checkout
            // compara el desglose calculado, no este valor. Deliberadamente
            // NUNCA se expone acá: id/updatedAt/updatedByUserId de cada
            // rango (eso es sólo para Developer > Configuración).
            configVersion: computeServiceFeeTiersVersion(tiers),
            // Beneficio inicial para compradores — sólo la duración en meses
            // (0 = sin promoción inicial), para los textos de
            // /costos-y-comisiones. Nunca decide nada del cobro: eso lo hace
            // createSaleForBuyer con Organization.serviceFeeWaivedUntil.
            serviceFeeWaiverDurationMonths,
        });
    } catch (error) {
        next(AppError.from(error));
    }
};
