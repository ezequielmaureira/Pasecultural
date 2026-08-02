import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import prisma from "../config/prisma.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import {
    createGuestSaleService,
    confirmSaleService,
    cancelSaleService,
    listSalesOrganizerService,
    listSalesBuyerService,
    getSaleStatusService,
} from "../services/sale.service.js";
import { resendSaleConfirmationEmailService } from "../services/email/sendSaleConfirmationEmail.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta. Toda la
// validación de negocio vive en sale.service.js — acá no hay ningún if de
// reglas de dominio.

// El comprador NUNCA necesita sesión de Clerk para comprar — este endpoint
// no lee getAuth/req.auth/userId en absoluto. firstName/lastName/email
// viajan sueltos en el body (no anidados bajo "buyer"); el resto del body
// es exactamente lo que necesita createGuestSaleService como datos de la
// venta.
export const createSale = async (req, res, next) => {
    try {
        const { firstName, lastName, email, ...saleData } = req.body;
        logger.info("createSale controller entered", { firstName, lastName, email, saleData });

        const sale = await createGuestSaleService(
            { firstName, lastName, email },
            saleData
        );

        logger.info("createSale controller completed", { saleId: sale.id, eventId: sale.eventId, functionId: sale.functionId });
        res.status(201).json({ sale });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const confirmSale = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await confirmSaleService(userId, req.params.id);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

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

// Confirmación disparada por el propio flujo de compra (pago manual/
// simulado hoy, webhook de Mercado Pago mañana). Sin sesión de Clerk no hay
// forma de verificar "sos vos el comprador" — la autorización acá es
// conocer el publicRecoveryToken, que sólo el navegador que creó la venta
// recibió (nunca el `id` interno: ese es la clave primaria, no un secreto).
// Es exactamente el mismo punto que el webhook de MP va a reemplazar el día
// de mañana (ver processPayment() del frontend), no un atajo temporal.
export const confirmSaleByBuyer = async (req, res, next) => {
    try {
        logger.info("confirmSaleByBuyer controller entered", { recoveryToken: req.params.token });
        if (!req.params.token) throw new Error(ErrorCodes.SALE_NOT_FOUND);

        const sale = await prisma.sale.findUnique({
            where: { publicRecoveryToken: req.params.token },
            include: { event: { include: { organization: true } } },
        });
        if (!sale || sale.deletedAt) throw new Error(ErrorCodes.SALE_NOT_FOUND);
        // CONFIRMED no se bloquea acá: confirmSaleService ya es idempotente
        // para ese caso (reintentos del frontend, timeout, polling, doble
        // solicitud) y devuelve el mismo resultado de éxito sin volver a
        // generar tickets. Sólo CANCELLED/EXPIRED siguen sin poder pasar.
        if (sale.status !== "PENDING" && sale.status !== "CONFIRMED") {
            throw new Error(ErrorCodes.SALE_NOT_PENDING);
        }

        const organizer = await prisma.user.findUnique({ where: { id: sale.event.organization.ownerId } });
        if (!organizer || !organizer.clerkId) throw new Error(ErrorCodes.USER_NOT_FOUND);

        const result = await confirmSaleService(organizer.clerkId, sale.id);
        logger.info("confirmSaleByBuyer controller completed", { saleId: sale.id, organizerId: organizer.id, organizerClerkId: organizer.clerkId });
        res.status(200).json(result);
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
