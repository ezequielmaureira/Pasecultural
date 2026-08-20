import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { normalizeBuyerDocument } from "../utils/validateBuyerDocument.js";
import { decryptMercadoPagoSecret } from "../config/mercadoPagoEncryption.js";
import { searchMercadoPagoMerchantOrdersByPreferenceId, searchMercadoPagoPaymentsByExternalReference } from "./mercadoPago.service.js";
import { logger } from "../logging/logger.js";

// Developer → Ventas — platform-wide a propósito, sólo lectura. No
// reutiliza listSalesOrganizerService (organizer-scoped vía
// getOrganizationByOwner): éste es un service completamente aparte, mismo
// criterio que developerEvents/developerTickets/developerScanners.service.js.
// "Venta" = exclusivamente origin:"SALE" (las COURTESY tienen su propio
// módulo, courtesy.service.js) + deletedAt:null siempre (sin toggle
// ACTIVE/DELETED/ALL en V1 — decisión cerrada en el contrato).

// SaleStatus no tiene un array exportado reutilizable sin tocar
// sale.service.js (fuera de alcance) — mismo motivo por el que los tres
// contratos anteriores definen su propio Set local.
const SALE_STATUS_VALUES = new Set(["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePage(rawPage) {
    const page = Number(rawPage);
    return Number.isInteger(page) && page >= 1 ? page : 1;
}

function parseLimit(rawLimit) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
    return Math.min(limit, MAX_LIMIT);
}

function buildWhere({ search, organizationId, eventId, status, needsReconciliation }) {
    const where = { origin: "SALE", deletedAt: null };
    const and = [];

    if (organizationId) where.event = { organizationId };
    if (eventId) where.eventId = eventId;
    if (SALE_STATUS_VALUES.has(status)) where.status = status;

    // "Requiere conciliación" (MP-6, ver auditoría): Mercado Pago aprobó un
    // pago que confirmSaleService no pudo cumplir por falta de stock — la
    // Sale quedó PENDING con `paymentRef` seteado al paymentId (ver
    // mercadoPagoWebhook.service.js, catch de INSUFFICIENT_STOCK). Es
    // EXACTAMENTE esta condición, sin SaleStatus nuevo ni campo nuevo.
    // Pisa cualquier `status` recibido a propósito: el filtro sólo tiene
    // sentido acotado a PENDING, nunca combinado con otro status.
    if (needsReconciliation === true) {
        where.status = "PENDING";
        where.paymentRef = { not: null };
    }

    const term = search?.trim();
    if (term) {
        const normalizedDocument = normalizeBuyerDocument(term);
        and.push({
            OR: [
                { buyer: { firstName: { contains: term, mode: "insensitive" } } },
                { buyer: { lastName: { contains: term, mode: "insensitive" } } },
                { buyer: { email: { contains: term, mode: "insensitive" } } },
                ...(normalizedDocument ? [{ buyerDocument: { contains: normalizedDocument } }] : []),
            ],
        });
    }

    if (and.length > 0) where.AND = and;

    return where;
}

export const listDeveloperSalesService = async (filters = {}) => {
    const page = parsePage(filters.page);
    const limit = parseLimit(filters.limit);
    const skip = (page - 1) * limit;
    const where = buildWhere(filters);

    // count + findMany en paralelo — _count.tickets viaja anidado en el
    // mismo findMany (Sale.tickets es relación Prisma formal, no un id
    // suelto): cero batch adicional, a diferencia de Entradas/Scanners.
    const [total, sales] = await Promise.all([
        prisma.sale.count({ where }),
        prisma.sale.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                status: true,
                total: true,
                ticketsSubtotal: true,
                serviceFee: true,
                createdAt: true,
                paymentRef: true,
                event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
                buyer: { select: { firstName: true, lastName: true } },
                _count: { select: { tickets: true } },
            },
        }),
    ]);

    const items = sales.map((sale) => ({
        id: sale.id,
        status: sale.status,
        event: { id: sale.event.id, title: sale.event.title },
        organization: sale.event.organization,
        buyer: { name: [sale.buyer.firstName, sale.buyer.lastName].filter(Boolean).join(" ").trim() || null },
        ticketsCount: sale._count.tickets,
        total: Number(sale.total),
        // MP-6 — NULL para MANUAL/Courtesy y para Sale de Mercado Pago
        // anteriores a esta migración (nunca hay backfill retroactivo) —
        // el frontend lo trata como "sin desglose de comisión disponible",
        // nunca asume $0.
        ticketsSubtotal: sale.ticketsSubtotal == null ? null : Number(sale.ticketsSubtotal),
        serviceFee: sale.serviceFee == null ? null : Number(sale.serviceFee),
        createdAt: sale.createdAt,
        paymentRef: sale.paymentRef,
        // Derivado, no persistido — misma condición que buildWhere de
        // arriba (status=PENDING AND paymentRef != null). Se manda ya
        // resuelto para que el frontend no tenga que reimplementar la
        // regla para distinguir esta fila de un PENDING normal.
        needsReconciliation: sale.status === "PENDING" && sale.paymentRef != null,
    }));

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    };
};

export const getDeveloperSaleService = async (saleId) => {
    // origin:"SALE" también acá: una COURTESY nunca debe poder verse por
    // detalle adivinando/copiando un id, aunque no aparezca en el listado
    // — mismo criterio "no existe" que el resto del catálogo de errores.
    const sale = await prisma.sale.findFirst({
        where: { id: saleId, origin: "SALE", deletedAt: null },
        select: {
            id: true,
            status: true,
            total: true,
            ticketsSubtotal: true,
            serviceFee: true,
            createdAt: true,
            confirmedAt: true,
            buyerDocument: true,
            paymentRef: true,
            event: { select: { id: true, title: true, organization: { select: { id: true, name: true } } } },
            function: { select: { id: true, date: true, venue: true } },
            buyer: { select: { firstName: true, lastName: true, email: true } },
            items: {
                select: {
                    id: true,
                    quantity: true,
                    unitPrice: true,
                    subtotal: true,
                    serviceFeeUnit: true,
                    serviceFeeSubtotal: true,
                    ticketType: { select: { id: true, name: true } },
                },
            },
            tickets: {
                where: { deletedAt: null },
                orderBy: { sequence: "asc" },
                select: { id: true, ticketNumber: true, status: true },
            },
        },
    });
    if (!sale) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    return {
        id: sale.id,
        status: sale.status,
        total: Number(sale.total),
        // MP-6 — ver comentario equivalente en listDeveloperSalesService.
        ticketsSubtotal: sale.ticketsSubtotal == null ? null : Number(sale.ticketsSubtotal),
        serviceFee: sale.serviceFee == null ? null : Number(sale.serviceFee),
        createdAt: sale.createdAt,
        confirmedAt: sale.confirmedAt,
        paymentRef: sale.paymentRef,
        // Misma derivación que listDeveloperSalesService — ver ese comentario.
        needsReconciliation: sale.status === "PENDING" && sale.paymentRef != null,
        event: { id: sale.event.id, title: sale.event.title },
        organization: sale.event.organization,
        function: sale.function,
        buyer: {
            name: [sale.buyer.firstName, sale.buyer.lastName].filter(Boolean).join(" ").trim() || null,
            email: sale.buyer.email,
            document: sale.buyerDocument,
        },
        items: sale.items.map((item) => ({
            id: item.id,
            ticketType: item.ticketType,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            subtotal: Number(item.subtotal),
            serviceFeeUnit: item.serviceFeeUnit == null ? null : Number(item.serviceFeeUnit),
            serviceFeeSubtotal: item.serviceFeeSubtotal == null ? null : Number(item.serviceFeeSubtotal),
        })),
        tickets: sale.tickets.map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            status: ticket.status,
        })),
    };
};

// ==================================================================
// Diagnóstico de Mercado Pago (Developer, SOLO LECTURA) — para investigar
// un intento de Checkout Pro real que falló antes de generar webhook, sin
// crear una compra nueva. Nunca confirma la Sale, nunca crea Ticket, nunca
// toca stock, nunca escribe en MercadoPagoConnection ni en ningún otro
// lado — a propósito NO reusa getValidMercadoPagoAccessTokenForOrganization
// (mercadoPagoConnection.service.js), que SÍ puede renovar y PERSISTIR un
// access_token nuevo si está por vencer: acá se resuelve la conexión
// ACTIVE y se decripta el token tal cual está, sin ningún efecto
// secundario — si Mercado Pago lo rechaza por vencido, esta herramienta
// sólo informa el fallo, nunca renueva nada.
//
// La credencial usada es SIEMPRE la conexión ACTIVE de la Organization
// dueña del evento de ESTA Sale — nunca una credencial global de la app ni
// la de otra Organization (mismo criterio de scoping que MP-2/MP-3).
// ==================================================================

export const getMercadoPagoSaleDiagnosticsService = async (saleId) => {
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: {
            id: true,
            status: true,
            total: true,
            paymentMethod: true,
            mercadoPagoPreferenceId: true,
            mercadoPagoExternalReference: true,
            mercadoPagoPaymentId: true,
            event: { select: { organizationId: true } },
        },
    });
    if (!sale) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const saleView = {
        id: sale.id,
        status: sale.status,
        total: Number(sale.total),
        mercadoPagoPreferenceId: sale.mercadoPagoPreferenceId,
        mercadoPagoExternalReference: sale.mercadoPagoExternalReference,
        mercadoPagoPaymentId: sale.mercadoPagoPaymentId,
    };

    if (sale.paymentMethod !== "MERCADO_PAGO") {
        return { sale: saleView, connection: { resolved: false, reason: "NOT_MERCADOPAGO_SALE" }, merchantOrders: [], payments: [] };
    }
    if (!sale.mercadoPagoPreferenceId && !sale.mercadoPagoExternalReference) {
        return { sale: saleView, connection: { resolved: false, reason: "NO_MERCADOPAGO_IDENTIFIERS" }, merchantOrders: [], payments: [] };
    }

    const connection = await prisma.mercadoPagoConnection.findFirst({
        where: { organizationId: sale.event.organizationId, status: "ACTIVE" },
        select: { mercadoPagoUserId: true, accessTokenEncrypted: true },
    });
    if (!connection) {
        return { sale: saleView, connection: { resolved: false, reason: "NOT_CONNECTED" }, merchantOrders: [], payments: [] };
    }

    const accessToken = decryptMercadoPagoSecret(connection.accessTokenEncrypted);

    const [merchantOrderResult, paymentsResult] = await Promise.all([
        sale.mercadoPagoPreferenceId
            ? searchMercadoPagoMerchantOrdersByPreferenceId({ accessToken, preferenceId: sale.mercadoPagoPreferenceId })
            : Promise.resolve({ success: false, error: "NO_PREFERENCE_ID" }),
        sale.mercadoPagoExternalReference
            ? searchMercadoPagoPaymentsByExternalReference({ accessToken, externalReference: sale.mercadoPagoExternalReference })
            : Promise.resolve({ success: false, error: "NO_EXTERNAL_REFERENCE" }),
    ]);

    // Nunca se loguea accessToken/refreshToken ni ningún dato de payer —
    // sólo metadata de diagnóstico del propio proceso (mismo criterio que
    // el resto de los services de Mercado Pago).
    logger.info("mercadopago diagnostics: consulta de sólo lectura realizada", {
        saleId,
        organizationId: sale.event.organizationId,
        merchantOrderSuccess: merchantOrderResult.success,
        paymentsSuccess: paymentsResult.success,
    });

    return {
        sale: saleView,
        connection: { resolved: true, mercadoPagoUserId: connection.mercadoPagoUserId },
        merchantOrders: merchantOrderResult.success ? merchantOrderResult.merchantOrders : [],
        merchantOrderError: merchantOrderResult.success ? null : merchantOrderResult.error,
        payments: paymentsResult.success ? paymentsResult.payments : [],
        paymentsError: paymentsResult.success ? null : paymentsResult.error,
    };
};
