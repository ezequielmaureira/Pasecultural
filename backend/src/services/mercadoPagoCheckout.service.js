import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { createGuestSaleService } from "./sale.service.js";
import { getValidMercadoPagoAccessTokenForOrganization } from "./mercadoPagoConnection.service.js";
import { createMercadoPagoPreference } from "./mercadoPago.service.js";
import { calculatePlatformFee } from "../config/platformFee.js";
import { round2 } from "../utils/money.js";
import { logger } from "../logging/logger.js";

// MP-2.1 — Rapipago/Pago Fácil y demás medios en efectivo (payment_type_id
// "ticket", confirmado contra la documentación oficial) pueden tardar 3+
// días hábiles en acreditarse — incompatibles con cualquier reserva de
// stock de duración corta (ver STOCK_RESERVATION_TTL_MS en
// sale.service.js). Se excluyen acá, en la preferencia, para que el único
// medio de pago disponible en Checkout Pro para entradas sea instantáneo
// (tarjeta de crédito/débito, dinero en cuenta) — decisión de producto
// confirmada explícitamente, no asumida.
const EXCLUDED_PAYMENT_TYPES = [{ id: "ticket" }];

// MP-2 — arma el inicio real de una compra: Sale PENDING (paymentMethod
// MERCADO_PAGO) + preferencia de Checkout Pro con Split Payment 1:1, a
// nombre del organizador dueño del evento (nunca credenciales propias de
// PaseCultural). Es el primer módulo que USA de verdad la conexión OAuth
// de MP-1 — hasta esta fase sólo se guardaba.
//
// NUNCA confirma la venta, NUNCA emite Ticket/QR, NUNCA manda el email de
// confirmación: eso sigue siendo exclusivamente confirmSaleService, que en
// esta fase nadie llama desde acá (MP-3 lo va a disparar desde un webhook
// server-to-server, nunca desde este flujo ni desde el redirect del
// comprador). Ver el informe de entrega de MP-2 para el diseño completo.

function buildFrontendCheckoutUrl(params) {
    const base = process.env.FRONTEND_URL?.trim()?.replace(/\/+$/, "");
    if (!base) {
        throw new Error("Falta configurar la variable de entorno FRONTEND_URL.");
    }
    const url = new URL(`${base}/comprar`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    return url.toString();
}

// Opcional a propósito: MP-2 no procesa notificaciones todavía (eso es
// MP-3, ver el informe). Si no está configurada, la preferencia se crea
// igual sin ese campo — Mercado Pago no la exige para crear una preferencia.
let cachedNotificationUrl;
function getMercadoPagoNotificationUrl() {
    if (cachedNotificationUrl !== undefined) return cachedNotificationUrl;
    const value = process.env.MERCADOPAGO_NOTIFICATION_URL?.trim();
    cachedNotificationUrl = value || null;
    return cachedNotificationUrl;
}

function isCheckoutIdempotencyKeyConflict(error) {
    if (error?.code !== "P2002") return false;
    const target = error?.meta?.target;
    if (Array.isArray(target)) return target.includes("checkoutIdempotencyKey");
    return typeof target === "string" && target.includes("checkoutIdempotencyKey");
}

// buyerInfo: { firstName, lastName, email } — igual que createGuestSaleService.
// saleInput: { eventId, functionId, items, buyerDocument } — igual que
// createSale, el frontend NUNCA manda precio/total/comisión, sólo qué y
// cuánto quiere comprar.
// idempotencyKey: opcional, generado por el frontend UNA vez por intento de
// compra (no por request) — ver el informe de entrega, sección Idempotencia.
export async function createMercadoPagoCheckoutService(buyerInfo, saleInput, idempotencyKey) {
    // 1) Replay idempotente — antes de tocar cualquier otra cosa. Un mismo
    // checkoutIdempotencyKey nunca crea una segunda Sale ni una segunda
    // preferencia, sea por doble click, reintento de React o de la red.
    if (idempotencyKey) {
        const existing = await prisma.sale.findUnique({ where: { checkoutIdempotencyKey: idempotencyKey } });
        if (existing) {
            if (existing.status === "PENDING" && existing.mercadoPagoInitPoint) {
                logger.info("mercadopago checkout: replay idempotente", { saleId: existing.id });
                return { checkoutUrl: existing.mercadoPagoInitPoint, saleToken: existing.publicRecoveryToken };
            }
            // Ya existe una fila para este intento pero no hay ningún
            // checkout usable para devolver: o sigue en construcción por
            // otra llamada concurrente con la misma clave, o ya se
            // canceló por una falla anterior (ver más abajo). En ningún
            // caso se reintenta creando una Sale nueva con la misma clave
            // — chocaría contra el unique constraint igual.
            throw new AppError(ErrorCodes.MERCADOPAGO_CHECKOUT_ALREADY_ATTEMPTED);
        }
    }

    // 2) Resolver la Organization dueña del evento y su conexión de
    // Mercado Pago ANTES de crear ninguna Sale — si no está conectada, no
    // tiene sentido dejar una PENDING sin ningún camino posible a pagarse.
    const event = await prisma.event.findUnique({ where: { id: saleInput?.eventId } });
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const accessToken = await getValidMercadoPagoAccessTokenForOrganization(event.organizationId);

    // 3) Crear la Sale PENDING — reusa EXACTO el mismo núcleo de
    // validación/precio/stock best-effort que el checkout manual
    // (createSaleForBuyer vía createGuestSaleService): el backend siempre
    // recalcula precio desde la DB, nunca confía en lo que mandó el
    // frontend.
    // Identificador de correlación DEDICADO para Mercado Pago — nunca
    // publicRecoveryToken (ver el informe de MP-2.1, sección external_
    // reference): ese campo es un bearer token que autoriza confirm-by-
    // buyer/status/pdf/resend-email, y entregárselo a un tercero como
    // simple id de correlación sería regalar una credencial de
    // recuperación real. Mismo generador que el resto de los tokens
    // públicos del proyecto.
    const mercadoPagoExternalReference = crypto.randomBytes(24).toString("base64url");

    let sale;
    try {
        sale = await createGuestSaleService(buyerInfo, saleInput, {
            paymentMethod: "MERCADO_PAGO",
            checkoutIdempotencyKey: idempotencyKey || null,
            mercadoPagoExternalReference,
        });
    } catch (error) {
        if (isCheckoutIdempotencyKeyConflict(error)) {
            throw new AppError(ErrorCodes.MERCADOPAGO_CHECKOUT_ALREADY_ATTEMPTED);
        }
        throw error;
    }

    // 4) Items para Mercado Pago — EXCLUSIVAMENTE desde lo que la Sale ya
    // persistió (sale.items, con unitPrice ya recalculado por el backend),
    // nunca desde saleInput.items (que sólo trae ticketTypeId/quantity, sin
    // precio) ni desde nada que haya mandado el frontend.
    const items = sale.items.map((item) => ({
        id: item.ticketTypeId,
        title: item.ticketType?.name || "Entrada",
        quantity: item.quantity,
        unit_price: Number(item.unitPrice),
        currency_id: "ARS",
    }));

    // Invariante defensivo: la suma de lo que se le va a mandar a Mercado
    // Pago tiene que coincidir EXACTO con sale.total. Estructuralmente no
    // debería poder fallar nunca (items sale de la misma Sale que ya
    // calculó total), pero si alguna vez no coincidiera, se aborta ANTES
    // de llamar a Mercado Pago — nunca se cobra un monto distinto al que
    // ya se le mostró al comprador.
    const itemsTotal = round2(items.reduce((sum, item) => sum + round2(item.unit_price * item.quantity), 0));
    if (itemsTotal !== Number(sale.total)) {
        logger.error(new Error("mercadopago checkout: items total mismatch"), {
            saleId: sale.id,
            itemsTotal,
            saleTotal: sale.total.toString(),
        });
        await prisma.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
        throw new AppError(ErrorCodes.MERCADOPAGO_ITEMS_MISMATCH);
    }

    const platformFee = calculatePlatformFee(sale.total);

    const backUrlParams = { slug: event.slug, saleToken: sale.publicRecoveryToken };
    const backUrls = {
        success: buildFrontendCheckoutUrl(backUrlParams),
        pending: buildFrontendCheckoutUrl(backUrlParams),
        failure: buildFrontendCheckoutUrl(backUrlParams),
    };

    const preference = await createMercadoPagoPreference({
        accessToken,
        items,
        payer: {
            name: buyerInfo?.firstName || undefined,
            surname: buyerInfo?.lastName || undefined,
            email: buyerInfo?.email || undefined,
        },
        externalReference: sale.mercadoPagoExternalReference,
        marketplaceFee: platformFee,
        backUrls,
        notificationUrl: getMercadoPagoNotificationUrl() ?? undefined,
        excludedPaymentTypes: EXCLUDED_PAYMENT_TYPES,
    });

    if (!preference.success) {
        // La Sale ya existe (PENDING) pero sin preferencia no tiene ningún
        // camino posible a pagarse — se cancela acá mismo, nunca queda
        // colgada en PENDING para siempre. preference.error ya viene
        // saneado por mercadoPago.service.js (nunca el access_token).
        logger.warn("mercadopago checkout: fallo al crear la preferencia", { saleId: sale.id, reason: preference.error });
        await prisma.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
        throw new AppError(ErrorCodes.MERCADOPAGO_PREFERENCE_FAILED);
    }

    await prisma.sale.update({
        where: { id: sale.id },
        data: { mercadoPagoPreferenceId: preference.preferenceId, mercadoPagoInitPoint: preference.initPoint },
    });

    logger.info("mercadopago checkout: preferencia creada", { saleId: sale.id, organizationId: event.organizationId });
    return { checkoutUrl: preference.initPoint, saleToken: sale.publicRecoveryToken };
}
