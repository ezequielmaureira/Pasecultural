import crypto from "node:crypto";
import prisma from "../../config/prisma.js";
import { decryptSecret } from "../../config/qrEncryption.js";
import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { AppError } from "../../errors/AppError.js";
import { ErrorCodes } from "../../errors/ErrorCodes.js";
import { getUserByClerkId } from "../../utils/getUserByClerkId.js";
import { buildTicketQrImages } from "./ticketQrImages.js";
import { buildTicketsPdfBuffer } from "./ticketsPdf.js";
import { buildSaleConfirmationEmail } from "./saleConfirmationTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const SENDING_STALE_MS = 5 * 60 * 1000; // 5 minutos
const RESEND_CALL_TIMEOUT_MS = 10000; // nunca bloquear la respuesta HTTP indefinidamente por Resend

// Reclamo atómico de UN intento de envío: un solo UPDATE con WHERE, sin
// transacción explícita porque no la necesita — un UPDATE es atómico por sí
// mismo en Postgres. PENDING/FAILED siempre son reclamables; SENDING sólo si
// quedó colgado (el proceso se cayó a mitad de un envío anterior) hace más
// de SENDING_STALE_MS. SENT nunca se reclama acá salvo `force` (botón manual
// "Reenviar" — ver sendSaleConfirmationEmail): un SENDING fresco (<
// SENDING_STALE_MS) sigue sin poder reclamarse ni siquiera con force, para
// no pisar un envío que está en curso ahora mismo. Esta es la protección
// REAL contra duplicados — la idempotencyKey que Resend recibe más abajo es
// una segunda capa, no la principal (si dos requests llegan simultáneas,
// sólo una gana esta carrera; la otra ni siquiera intenta llamar a Resend).
async function claimEmailSendAttempt(saleId, { force = false } = {}) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SENDING_STALE_MS);

    const claimed = await prisma.sale.updateMany({
        where: {
            id: saleId,
            OR: [
                { confirmationEmailStatus: "PENDING" },
                { confirmationEmailStatus: "FAILED" },
                { confirmationEmailStatus: "SENDING", confirmationEmailLastAttemptAt: { lt: staleBefore } },
                ...(force ? [{ confirmationEmailStatus: "SENT" }] : []),
            ],
        },
        data: {
            confirmationEmailStatus: "SENDING",
            confirmationEmailLastAttemptAt: now,
            confirmationEmailAttempts: { increment: 1 },
        },
    });

    return claimed.count === 1;
}

async function markEmailSent(saleId, providerId) {
    await prisma.sale.updateMany({
        where: { id: saleId },
        data: {
            confirmationEmailStatus: "SENT",
            confirmationEmailSentAt: new Date(),
            confirmationEmailProviderId: providerId ?? null,
            confirmationEmailLastError: null,
        },
    });
}

// Nunca guarda el error crudo del proveedor (podría traer detalle interno)
// — sólo un motivo corto y ya sanitizado, suficiente para diagnosticar.
// `status` es a qué confirmationEmailStatus queda la fila: "FAILED" en el
// flujo normal (default), o "SENT" cuando un reenvío manual forzado falla
// sobre una venta que ya estaba SENT — ese intento fallido no debe borrar el
// rastro de que una entrega anterior sí funcionó (decisión explícita: un
// reenvío a pedido que falla no es lo mismo que la venta nunca haya
// entregado nada). El valor de retorno que ve el caller (sendSaleConfirmationEmail)
// sigue siendo siempre "FAILED" para ESE intento puntual, sin importar qué
// se persistió — ver más abajo.
async function markEmailFailed(saleId, reason, status = "FAILED") {
    const sanitized = String(reason ?? "unknown_error").slice(0, 200);
    await prisma.sale.updateMany({
        where: { id: saleId },
        data: { confirmationEmailStatus: status, confirmationEmailLastError: sanitized },
    });
    return sanitized;
}

// Todo lo que hace falta para armar el email, partiendo únicamente de
// saleId — así sendSaleConfirmationEmail() es invocable de forma
// independiente (auto-trigger post-confirmación o reintento administrativo)
// sin depender de que el caller ya tenga la venta cargada. El secret de
// cada QR se reconstruye acá al vuelo (decryptSecret), igual que en
// getSaleStatusService — nunca se persiste en texto plano. Exportada
// también para getSalePdfByTokenService (sale.service.js): arma el mismo
// PDF completo que ya se adjunta al email, sin duplicar la query de
// tickets/QR.
export async function getSaleEmailData(saleId) {
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: {
            id: true,
            status: true,
            publicRecoveryToken: true,
            buyer: { select: { firstName: true, email: true } },
            event: { select: { title: true } },
            function: { select: { date: true, venue: true } },
            tickets: {
                where: { deletedAt: null },
                select: {
                    id: true,
                    ticketNumber: true,
                    ticketType: { select: { name: true } },
                    qr: { select: { secretEncrypted: true } },
                },
                orderBy: { sequence: "asc" },
            },
        },
    });
    if (!sale) return null;

    const eventTitle = sale.event.title;
    const venue = sale.function.venue;
    const functionDate = sale.function.date;

    const tickets = sale.tickets
        .filter((ticket) => ticket.qr) // defensivo: no debería faltar nunca, pero no tira abajo el envío si pasa
        .map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            ticketTypeName: ticket.ticketType?.name ?? "",
            eventTitle,
            venue,
            functionDate,
            qrToken: `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`,
        }));

    return {
        saleId: sale.id,
        status: sale.status,
        publicRecoveryToken: sale.publicRecoveryToken,
        buyerEmail: sale.buyer?.email ?? null,
        buyerFirstName: sale.buyer?.firstName ?? "",
        eventTitle,
        venue,
        functionDate,
        tickets,
    };
}

// Punto único de envío del email de confirmación. Seguro de llamar varias
// veces para la MISMA venta — confirmSaleService lo dispara automáticamente
// después de confirmar (tanto si acaba de confirmar como si encuentra la
// venta ya CONFIRMED), y los dos endpoints de reenvío manual (organizador/
// developer por saleId, comprador por publicRecoveryToken) lo llaman de
// nuevo a pedido con `force: true`; en todos los casos el reclamo atómico de
// arriba decide si hay algo real que hacer. NUNCA lanza: cualquier fallo
// (dato faltante, Resend caído, timeout) queda registrado en
// confirmationEmailStatus/LastError y se devuelve como resultado — un email
// que no sale no puede convertir una compra ya confirmada en una compra
// fallida.
//
// `force` es EXCLUSIVO de los dos callers de reenvío manual explícito —
// confirmSaleService (auto-trigger post-confirmación) nunca lo pasa, así que
// su protección contra duplicados queda exactamente igual que siempre. Con
// force:
//   - claimEmailSendAttempt reclama también una venta ya SENT (no una
//     SENDING fresca: nunca se pisa un envío realmente en curso).
//   - el idempotencyKey que recibe Resend deja de ser fijo por venta y pasa
//     a ser único por intento — si siguiera siendo el mismo, Resend
//     devolvería la respuesta cacheada del primer envío sin mandar nada
//     nuevo, y esto seguiría roto un nivel más abajo del reclamo local.
//   - si el intento falla y la venta YA estaba SENT antes de este click, el
//     status persistido vuelve a "SENT" (no "FAILED"): un reenvío a pedido
//     que no prospera no borra el rastro de que una entrega anterior sí
//     funcionó. El valor que ve el caller para ESE intento puntual sigue
//     siendo "FAILED" igual — ver el return de cada rama de abajo.
export async function sendSaleConfirmationEmail(saleId, { force = false } = {}) {
    if (!saleId) return { attempted: false, status: null, reason: "missing_sale_id" };

    const wasSentBeforeThisAttempt = force
        ? (await prisma.sale.findUnique({ where: { id: saleId }, select: { confirmationEmailStatus: true } }))
              ?.confirmationEmailStatus === "SENT"
        : false;
    const persistedFailureStatus = wasSentBeforeThisAttempt ? "SENT" : "FAILED";

    const claimed = await claimEmailSendAttempt(saleId, { force });
    if (!claimed) {
        const current = await prisma.sale.findUnique({ where: { id: saleId }, select: { confirmationEmailStatus: true } });
        logger.info("sendSaleConfirmationEmail: intento no reclamable", { saleId, currentStatus: current?.confirmationEmailStatus ?? null, force });
        return { attempted: false, status: current?.confirmationEmailStatus ?? null, reason: "not_claimable" };
    }

    try {
        const data = await getSaleEmailData(saleId);
        if (!data) {
            const reason = await markEmailFailed(saleId, "sale_not_found", persistedFailureStatus);
            return { attempted: true, status: "FAILED", reason };
        }
        if (data.status !== "CONFIRMED") {
            const reason = await markEmailFailed(saleId, "sale_not_confirmed", persistedFailureStatus);
            return { attempted: true, status: "FAILED", reason };
        }
        if (!data.buyerEmail) {
            const reason = await markEmailFailed(saleId, "missing_buyer_email", persistedFailureStatus);
            return { attempted: true, status: "FAILED", reason };
        }
        if (data.tickets.length === 0) {
            const reason = await markEmailFailed(saleId, "no_tickets_found", persistedFailureStatus);
            return { attempted: true, status: "FAILED", reason };
        }

        const { frontendUrl, from, replyTo } = getEmailConfig();
        // El correo ya es autosuficiente (QR + PDF adjunto con todas las
        // entradas), así que no lleva ningún link de recuperación como
        // acción principal. Este es sólo el link secundario de "perdí este
        // correo" — apunta al flujo de recuperación por email+DNI
        // (RecoverPurchase.jsx / recoverSalesService), no al acceso directo
        // por publicRecoveryToken: si perdió el correo, tampoco tiene ese
        // token a mano.
        const recoverPurchaseUrl = `${frontendUrl}/recuperar-compra`;

        const qrImages = await buildTicketQrImages(data.tickets);
        const qrContentIds = new Map(qrImages.map((qr) => [qr.ticket.id, qr.contentId]));

        const { subject, html, text } = buildSaleConfirmationEmail(
            {
                buyerFirstName: data.buyerFirstName,
                eventTitle: data.eventTitle,
                tickets: data.tickets,
                recoverPurchaseUrl,
                replyTo,
            },
            qrContentIds
        );

        const pdfBuffer = await buildTicketsPdfBuffer({
            eventTitle: data.eventTitle,
            venue: data.venue,
            functionDate: data.functionDate,
            tickets: data.tickets,
            qrImages,
        });

        const attachments = [
            ...qrImages.map((qr) => ({
                filename: `${qr.contentId}.png`,
                content: qr.buffer,
                contentType: "image/png",
                contentId: qr.contentId,
            })),
            {
                filename: `entradas-pasecultural-${data.saleId}.pdf`,
                content: pdfBuffer,
                contentType: "application/pdf",
            },
        ];

        const resend = getResendClient();
        // Ver comentario grande de arriba: fijo por venta en el flujo
        // normal (protege al auto-trigger de un doble envío si Resend
        // recibe la misma request dos veces), único por intento cuando
        // force=true (si no, Resend nunca ejecutaría un envío nuevo).
        const idempotencyKey = force
            ? `sale-confirmed/${data.saleId}/manual-resend-${crypto.randomUUID()}`
            : `sale-confirmed/${data.saleId}`;
        const result = await withTimeout(
            resend.emails.send(
                { from, to: data.buyerEmail, replyTo, subject, html, text, attachments },
                { idempotencyKey }
            ),
            RESEND_CALL_TIMEOUT_MS,
            "resend_timeout"
        );

        if (result.error) {
            const reason = await markEmailFailed(saleId, result.error.name || "resend_error", persistedFailureStatus);
            logger.error("sendSaleConfirmationEmail: Resend devolvió un error", { saleId, errorName: result.error.name, force });
            return { attempted: true, status: "FAILED", reason };
        }

        await markEmailSent(saleId, result.data?.id);
        logger.info("sendSaleConfirmationEmail: enviado", { saleId, providerId: result.data?.id, force });
        return { attempted: true, status: "SENT", providerId: result.data?.id };
    } catch (err) {
        const reason = await markEmailFailed(
            saleId,
            err?.message === "resend_timeout" ? "resend_timeout" : "send_failed",
            persistedFailureStatus
        );
        // No se loguea err.message/err.stack tal cual: en teoría podrían
        // traer un fragmento del input si algo de la generación de QR/PDF
        // fallara con un mensaje que lo incluya. saleId + el nombre del
        // error alcanza para diagnosticar sin arriesgar volcar un qrToken.
        logger.error("sendSaleConfirmationEmail: intento fallido", { saleId, errorName: err?.name || "Error", force });
        return { attempted: true, status: "FAILED", reason };
    }
}

// Reenvío administrativo (DEVELOPER, u ORGANIZER dueño del evento de esa
// venta). No acepta un email arbitrario del body — siempre manda al
// buyerEmail ya guardado. No revela el motivo interno de un fallo previo,
// sólo si se pudo enviar o no. Es, igual que resendConfirmationEmailByTokenService
// (sale.service.js), una acción manual explícita disparada por una persona
// que apretó un botón "Reenviar" — así que usa force:true: si la venta ya
// estaba SENT, este llamado SÍ tiene que volver a golpear Resend de verdad,
// no reportar éxito sin haber hecho nada.
export async function resendSaleConfirmationEmailService(clerkId, saleId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: {
            id: true,
            status: true,
            deletedAt: true,
            event: { select: { organization: { select: { ownerId: true } } } },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const isDeveloper = user.role === "DEVELOPER";
    const isOwningOrganizer = user.role === "ORGANIZER" && sale.event.organization.ownerId === user.id;
    if (!isDeveloper && !isOwningOrganizer) {
        // No se distingue de "no existe": no hace falta confirmarle a un
        // organizador ajeno que esa venta sí existe en otra organización.
        throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    }
    if (sale.status !== "CONFIRMED") throw new AppError(ErrorCodes.SALE_NOT_CONFIRMED);

    // Mismo criterio que resendConfirmationEmailByTokenService (sale.service.js):
    // sendSaleConfirmationEmail() nunca lanza, así que un fallo real de envío
    // hay que traducirlo a error acá — si no, este endpoint también devolvía
    // 200 con emailDeliveryStatus: "FAILED" y el caller lo tomaba como éxito.
    const result = await sendSaleConfirmationEmail(sale.id, { force: true });
    if (result.status === "FAILED") {
        throw new AppError(ErrorCodes.SALE_EMAIL_RESEND_FAILED);
    }
    return { emailDeliveryStatus: result.status ?? "PENDING", sent: result.status === "SENT" };
}
