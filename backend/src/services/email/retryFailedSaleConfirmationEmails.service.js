import prisma from "../../config/prisma.js";
import { logger } from "../../logging/logger.js";
import { sendSaleConfirmationEmail } from "./sendSaleConfirmationEmail.service.js";

// Ronda de preparación para producción — reintento automático del email
// de confirmación de compra (antes: un FAILED quedaba así hasta que el
// comprador pidiera un reenvío o alguien lo hiciera a mano).
//
// Sin duplicados, por dos capas que ya existían y no se tocan:
//  1. claimEmailSendAttempt (sendSaleConfirmationEmail.service.js): sólo un
//     proceso a la vez puede pasar la fila a SENDING — un SENT nunca se
//     vuelve a reclamar (este job nunca usa `force`).
//  2. idempotencyKey fija por venta en Resend (`sale-confirmed/<saleId>`):
//     si un intento anterior sí se entregó pero la respuesta se perdió
//     (timeout), Resend devuelve el envío original en vez de mandar otro.
//
// Qué se reintenta: ventas CONFIRMED de origen SALE (nunca cortesías) con
// el email en FAILED, o todavía en
// PENDING varios minutos después de confirmadas (el envío automático nunca
// llegó a correr — proceso reiniciado, error antes de reclamar), con menos
// de MAX_ATTEMPTS intentos, confirmadas en los últimos MAX_AGE_DAYS días, y
// con espera creciente entre intentos (BACKOFF_STEP_MS × intentos previos).
export const EMAIL_RETRY_MAX_ATTEMPTS = 5;
const MAX_AGE_DAYS = 7;
const PENDING_GRACE_MS = 5 * 60 * 1000;
const BACKOFF_STEP_MS = 10 * 60 * 1000;
const BATCH_SIZE = 25;

export function isDueForEmailRetry(sale, now = new Date()) {
    if (sale.confirmationEmailAttempts >= EMAIL_RETRY_MAX_ATTEMPTS) return false;
    if (sale.confirmationEmailStatus === "PENDING") {
        return Boolean(sale.confirmedAt) && now - new Date(sale.confirmedAt) >= PENDING_GRACE_MS;
    }
    if (sale.confirmationEmailStatus !== "FAILED") return false;
    if (!sale.confirmationEmailLastAttemptAt) return true;
    const wait = BACKOFF_STEP_MS * Math.max(sale.confirmationEmailAttempts, 1);
    return now - new Date(sale.confirmationEmailLastAttemptAt) >= wait;
}

export async function retryFailedSaleConfirmationEmailsService({ now = new Date(), send = sendSaleConfirmationEmail } = {}) {
    const candidates = await prisma.sale.findMany({
        where: {
            status: "CONFIRMED",
            // Sólo ventas reales. Una cortesía "Compartir" (deliveryMethod
            // SHARE) nunca manda email a propósito (skipAutoEmail en
            // courtesy.service.js) y su estado queda PENDING para siempre —
            // reintentarla le mandaría al organizador un email que nadie
            // pidió. Una cortesía por EMAIL que falle se reenvía a mano, como
            // hasta ahora.
            origin: "SALE",
            deletedAt: null,
            confirmationEmailStatus: { in: ["FAILED", "PENDING"] },
            confirmationEmailAttempts: { lt: EMAIL_RETRY_MAX_ATTEMPTS },
            confirmedAt: { gte: new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000) },
        },
        select: {
            id: true,
            confirmedAt: true,
            confirmationEmailStatus: true,
            confirmationEmailAttempts: true,
            confirmationEmailLastAttemptAt: true,
        },
        orderBy: { confirmedAt: "asc" },
        take: BATCH_SIZE * 4,
    });

    const due = candidates.filter((sale) => isDueForEmailRetry(sale, now)).slice(0, BATCH_SIZE);
    const summary = { candidateCount: candidates.length, attempted: 0, sent: 0, failed: 0, skipped: 0 };

    for (const sale of due) {
        try {
            const outcome = await send(sale.id);
            if (!outcome?.attempted) summary.skipped += 1;
            else if (outcome.status === "SENT") summary.sent += 1;
            else summary.failed += 1;
            if (outcome?.attempted) summary.attempted += 1;
        } catch (error) {
            summary.failed += 1;
            logger.error(error, { context: "email retry: fallo inesperado reintentando un email de confirmación", saleId: sale.id });
        }
    }

    if (due.length > 0) logger.info("email retry: ronda completada", summary);
    return summary;
}
