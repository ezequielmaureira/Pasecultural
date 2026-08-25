import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { getMercadoPagoPayment } from "./mercadoPago.service.js";
import { getValidMercadoPagoAccessTokenForConnection } from "./mercadoPagoConnection.service.js";
import { confirmSaleService } from "./sale.service.js";
import {
    sendMercadoPagoReconciliationAlert,
    sendMercadoPagoReversalAlert,
    sendMercadoPagoCredentialUnresolvableAlert,
} from "./email/sendMercadoPagoReconciliationAlert.service.js";
import { round2 } from "../utils/money.js";
import { sendDeveloperAlert, DeveloperAlertType, tryClaimDeveloperAlertCooldown } from "./email/sendDeveloperAlert.service.js";
import { getDeveloperAlertConfigOrDefaults } from "./developerAlertConfig.service.js";

// Reconciliación de pagos — núcleo de validación/confirmación de Mercado
// Pago EXTRAÍDO de mercadoPagoWebhook.service.js (que hasta esta ronda lo
// tenía inline), para que el webhook Y la reconciliación (automática y
// manual, ver mercadoPagoReconciliation.service.js) compartan EXACTAMENTE
// la misma lógica financiera — nunca dos implementaciones. La única
// diferencia entre los callers es CÓMO llegan a un `paymentId` candidato
// para consultar (el webhook lo recibe de la notificación; la
// reconciliación lo descubre buscando en Mercado Pago) — a partir de ahí,
// todo el camino es idéntico.
//
// `candidateConnectionId` reemplaza a lo que antes era la resolución por
// `bodyUserId` DENTRO de esta función: ahora es el caller quien decide de
// dónde sale ese candidato (el webhook lo resuelve de bodyUserId — pista
// de enrutamiento, nunca autorización; la reconciliación pasa la conexión
// con la que efectivamente encontró el payment en una búsqueda ya scoped a
// esa cuenta) — la validación real (collector_id, external_reference,
// organización, monto, moneda) es exactamente la misma después de este
// punto, sin importar el origen del candidato.
//
// `source` es sólo para observabilidad (logs + Sale.confirmationSource,
// ver la migración de esta ronda) — nunca cambia ninguna decisión
// financiera.

const APPROVED_STATUS = "approved";
// Bug fix (reintentos de Checkout Pro) — terminal SÓLO para ESTE intento de
// pago puntual, NUNCA para la Sale: Checkout Pro ofrece "pagar con otro
// medio" sobre la MISMA preference/external_reference después de un
// rechazo, así que un rejected/cancelled individual nunca debe cancelar la
// Sale ni liberar su reserva de stock. La Sale sigue PENDING y sigue
// pudiendo recibir un payment distinto después.
const PAYMENT_ATTEMPT_FAILED_STATUSES = new Set(["rejected", "cancelled"]);
// Reversión sobre un pago que YA fue aprobado — nunca se deshace nada, sólo
// se deja constancia.
const REVERSAL_STATUSES = new Set(["refunded", "charged_back"]);

// outcome.ok === false SÓLO para fallas transitorias (el caller HTTP —
// mercadoPagoWebhook.controller.js — debe devolver 500 para que Mercado
// Pago reintente más tarde). Todo lo demás es outcome.ok === true: la
// verificación en sí se procesó correctamente, aunque no haya nada más que
// hacer (o nada que se pueda hacer con seguridad).
export async function confirmMercadoPagoPaymentIfEligible({ paymentId, candidateConnectionId = null, source = "WEBHOOK" }) {
    const normalizedPaymentId = String(paymentId);

    // 1) Si este payment id ya está vinculado a una Sale, se reusa esa
    // vinculación SÓLO para resolver más rápido con qué credencial
    // consultar (nunca para saltear la consulta en sí): Mercado Pago puede
    // mandar varias notificaciones distintas para el mismo payment id a lo
    // largo de su vida (creado -> aprobado -> más tarde reembolsado), y
    // cortar acá antes de volver a consultar dejaría pasar por alto un
    // reembolso/contracargo posterior sobre un payment ya confirmado.
    const alreadyLinked = await prisma.sale.findUnique({ where: { mercadoPagoPaymentId: normalizedPaymentId } });
    let connection = null;
    if (alreadyLinked) {
        connection = await prisma.mercadoPagoConnection.findFirst({
            where: { organization: { events: { some: { id: alreadyLinked.eventId } } } },
        });
    }

    // 2) Si no se resolvió por la Sale ya vinculada, se usa el candidato
    // que el caller haya podido proponer (bodyUserId para el webhook,
    // la conexión con la que la reconciliación encontró el payment en una
    // búsqueda scoped). Nunca es autorización por sí solo: si el candidato
    // es incorrecto, la propia consulta a Mercado Pago (scoped a la cuenta
    // del token elegido) y el chequeo de collector_id de más abajo lo
    // descartan igual.
    if (!connection && candidateConnectionId) {
        connection = await prisma.mercadoPagoConnection.findUnique({ where: { id: candidateConnectionId } });
    }
    if (!connection) {
        logger.warn("mercadopago confirmation: no se pudo resolver ninguna organización candidata para este payment", {
            paymentId: normalizedPaymentId,
            source,
            hadCandidateConnectionId: Boolean(candidateConnectionId),
        });
        return { ok: true, action: "unresolvable", reason: "NO_CANDIDATE_CONNECTION" };
    }

    // Bug fix (desconexión de Mercado Pago) — SIEMPRE el token de ESTA fila
    // `connection` ya resuelta, NUNCA "la conexión ACTIVE actual de la
    // Organization": si la Organization desconectó esta cuenta y conectó
    // otra distinta entre el cobro y esta verificación, la ACTIVE actual ya
    // no es la cuenta que hizo este payment.
    let accessToken;
    try {
        accessToken = await getValidMercadoPagoAccessTokenForConnection(connection.id);
    } catch (credentialError) {
        logger.error(credentialError, {
            context:
                "mercadopago confirmation: no se pudo obtener una credencial válida para reconsultar el payment — se preserva el reintento (500) si aplica, no se toca Sale/Ticket",
            paymentId: normalizedPaymentId,
            source,
            connectionId: connection.id,
            connectionStatus: connection.status,
            saleId: alreadyLinked?.id ?? null,
        });
        if (alreadyLinked) {
            const alertResult = await sendMercadoPagoCredentialUnresolvableAlert({
                saleId: alreadyLinked.id,
                paymentId: normalizedPaymentId,
                eventId: alreadyLinked.eventId,
                organizationId: connection.organizationId,
                connectionId: connection.id,
                connectionStatus: connection.status,
                reason: credentialError?.code ?? "UNKNOWN",
            });
            if (!alertResult.sent) {
                logger.error(new Error("mercadopago confirmation: no se pudo enviar la alerta de credencial no verificable"), {
                    saleId: alreadyLinked.id,
                    paymentId: normalizedPaymentId,
                    reason: alertResult.reason,
                });
            }
        }
        throw credentialError;
    }
    const payment = await getMercadoPagoPayment({ accessToken, paymentId: normalizedPaymentId });

    if (!payment.success) {
        const transient =
            payment.error === "TIMEOUT" ||
            payment.error === "NETWORK_ERROR" ||
            (typeof payment.httpStatus === "number" && payment.httpStatus >= 500);
        logger.warn("mercadopago confirmation: fallo al consultar el payment", {
            paymentId: normalizedPaymentId,
            source,
            reason: payment.error,
            transient,
        });
        if (!transient && alreadyLinked) {
            const alertResult = await sendMercadoPagoCredentialUnresolvableAlert({
                saleId: alreadyLinked.id,
                paymentId: normalizedPaymentId,
                eventId: alreadyLinked.eventId,
                organizationId: connection.organizationId,
                connectionId: connection.id,
                connectionStatus: connection.status,
                reason: payment.error,
            });
            if (!alertResult.sent) {
                logger.error(new Error("mercadopago confirmation: no se pudo enviar la alerta de credencial no verificable"), {
                    saleId: alreadyLinked.id,
                    paymentId: normalizedPaymentId,
                    reason: alertResult.reason,
                });
            }
        }
        return transient
            ? { ok: false, action: "transient_error", reason: payment.error }
            : { ok: true, action: "unresolvable", reason: payment.error };
    }

    // Defensa adicional: el fetch ya está scoped por el propio token de
    // Mercado Pago a la cuenta que lo emitió, pero nunca se asume.
    if (payment.collectorId && payment.collectorId !== connection.mercadoPagoUserId) {
        logger.error(new Error("mercadopago confirmation: collector_id del payment no coincide con la conexión resuelta"), {
            paymentId: normalizedPaymentId,
            source,
            resolvedOrganizationId: connection.organizationId,
        });
        return { ok: true, action: "unresolvable", reason: "COLLECTOR_MISMATCH" };
    }

    if (!payment.externalReference) {
        logger.warn("mercadopago confirmation: payment sin external_reference", { paymentId: normalizedPaymentId, source });
        return { ok: true, action: "unresolvable", reason: "MISSING_EXTERNAL_REFERENCE" };
    }

    // 3) Correlación PAYMENT -> Sale: exclusivamente por
    // mercadoPagoExternalReference (@unique en Sale, así que esto sólo
    // puede resolver 0 o 1 fila — nunca "más de una").
    const sale = await prisma.sale.findUnique({
        where: { mercadoPagoExternalReference: payment.externalReference },
        include: { event: { include: { organization: true } } },
    });
    if (!sale) {
        logger.warn("mercadopago confirmation: ningún Sale corresponde a este external_reference", { paymentId: normalizedPaymentId, source });
        return { ok: true, action: "unresolvable", reason: "SALE_NOT_FOUND" };
    }

    if (sale.paymentMethod !== "MERCADO_PAGO") {
        logger.error(new Error("mercadopago confirmation: external_reference coincide con una Sale que no es de Mercado Pago"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
        });
        return { ok: true, action: "unresolvable", reason: "SALE_NOT_MERCADOPAGO" };
    }
    if (sale.event.organizationId !== connection.organizationId) {
        logger.error(
            new Error("mercadopago confirmation: la Sale resuelta pertenece a otra organización que la usada para consultar el payment"),
            { saleId: sale.id, paymentId: normalizedPaymentId, source }
        );
        return { ok: true, action: "unresolvable", reason: "ORGANIZATION_MISMATCH" };
    }

    // Reversión sobre un payment ya aprobado: nunca se deshace el cobro en
    // sí, nunca se toca Sale.status ni stock, pero SÍ se invalida el acceso
    // al evento: los Ticket ACTIVE de esta Sale pasan a REFUNDED. Sólo
    // aplica si la Sale llegó a confirmarse.
    if (REVERSAL_STATUSES.has(payment.status)) {
        let ticketsRefunded = 0;
        if (sale.status === "CONFIRMED") {
            const updated = await prisma.ticket.updateMany({
                where: { saleId: sale.id, status: "ACTIVE" },
                data: { status: "REFUNDED" },
            });
            ticketsRefunded = updated.count;
        }
        logger.error(new Error(`mercadopago confirmation: payment revertido (${payment.status}) recibido`), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            saleStatus: sale.status,
            ticketsRefunded,
        });

        const reversalAlertResult = await sendMercadoPagoReversalAlert({
            type: payment.status === "refunded" ? "REFUNDED" : "CHARGED_BACK",
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            eventId: sale.eventId,
            organizationId: sale.event.organizationId,
            ticketsAffected: ticketsRefunded,
        });
        if (!reversalAlertResult.sent) {
            logger.error(new Error("mercadopago confirmation: no se pudo enviar la alerta interna de reversión"), {
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                paymentStatus: payment.status,
                reason: reversalAlertResult.reason,
            });
        }

        try {
            const reversalType = payment.status === "refunded" ? "REFUNDED" : "CHARGED_BACK";
            const organizationId = sale.event.organizationId;
            await prisma.developerAlertReversalEvent.create({
                data: { organizationId, saleId: sale.id, type: reversalType },
            });

            const config = await getDeveloperAlertConfigOrDefaults();
            const windowStart = new Date(Date.now() - config.refundsVolumeWindowHours * 60 * 60 * 1000);
            const count = await prisma.developerAlertReversalEvent.count({
                where: { organizationId, occurredAt: { gte: windowStart } },
            });
            if (count >= config.refundsVolumeWindowCount) {
                const claimed = await tryClaimDeveloperAlertCooldown(`${DeveloperAlertType.REFUNDS_VOLUME_SPIKE}:${organizationId}`, config.alertCooldownMinutes);
                if (claimed) {
                    const volumeAlertResult = await sendDeveloperAlert(DeveloperAlertType.REFUNDS_VOLUME_SPIKE, {
                        organizationId,
                        organizationName: sale.event.organization.name,
                        count,
                        windowHours: config.refundsVolumeWindowHours,
                        threshold: config.refundsVolumeWindowCount,
                    });
                    if (!volumeAlertResult.sent) {
                        logger.warn("mercadopago confirmation: no se pudo enviar la alerta Developer de volumen de refunds", { organizationId, reason: volumeAlertResult.reason });
                    }
                }
            }
        } catch (err) {
            logger.error(err, { context: "mercadopago confirmation: fallo inesperado evaluando la alerta Developer de volumen de refunds (no afecta la reversión ya procesada)", saleId: sale.id });
        }

        return { ok: true, action: "reversal_acknowledged", saleId: sale.id, ticketsRefunded };
    }

    if (sale.status === "CONFIRMED") {
        logger.info("mercadopago confirmation: la Sale ya estaba CONFIRMED", { saleId: sale.id, paymentId: normalizedPaymentId, source });
        return { ok: true, action: "already_confirmed", saleId: sale.id };
    }

    if (sale.status !== "PENDING") {
        // CANCELLED/EXPIRED — la reserva ya no es válida, nunca se confirma.
        logger.warn("mercadopago confirmation: la Sale ya no está PENDING, no se confirma", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            saleStatus: sale.status,
        });
        return { ok: true, action: "unresolvable", reason: `SALE_STATUS_${sale.status}` };
    }

    if (PAYMENT_ATTEMPT_FAILED_STATUSES.has(payment.status)) {
        // Este intento puntual falló, pero la Sale sigue PENDING y su
        // reserva de stock queda exactamente igual: nunca se escribe nada
        // acá. Checkout Pro puede seguir ofreciendo "pagar con otro medio"
        // sobre la MISMA preference/external_reference, y un payment
        // distinto (nuevo id) puede llegar aprobado después.
        logger.info("mercadopago confirmation: intento de pago individual terminó negativo, la Sale sigue PENDING", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            paymentStatus: payment.status,
            saleStatus: sale.status,
        });
        return { ok: true, action: "payment_attempt_failed", saleId: sale.id };
    }

    if (payment.status !== APPROVED_STATUS) {
        // pending / in_process / in_mediation / cualquier otro no
        // reconocido — válido, no es un error: todavía no hay nada que
        // confirmar.
        logger.info("mercadopago confirmation: payment todavía no aprobado", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            paymentStatus: payment.status,
        });
        return { ok: true, action: "not_approved", saleId: sale.id, paymentStatus: payment.status };
    }

    // A partir de acá, payment.status === "approved" — validaciones
    // económicas EXACTAS antes de confirmar nada. Mismo criterio de
    // redondeo que el resto del proyecto (round2, ver utils/money.js).
    const expectedAmount = round2(sale.total);
    const paidAmount = round2(payment.transactionAmount);
    if (paidAmount !== expectedAmount) {
        logger.error(new Error("mercadopago confirmation: transaction_amount no coincide con Sale.total"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            expectedAmount,
            paidAmount,
        });
        return { ok: true, action: "unresolvable", reason: "AMOUNT_MISMATCH" };
    }
    if (payment.currencyId !== "ARS") {
        logger.error(new Error("mercadopago confirmation: currency_id inesperado"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            currencyId: payment.currencyId,
        });
        return { ok: true, action: "unresolvable", reason: "CURRENCY_MISMATCH" };
    }

    // Mismo mecanismo que confirmSaleByBuyer (sale.controller.js) ya usa
    // para el pago manual/simulado — "impersona" al organizador dueño de
    // la organización para poder llamar a confirmSaleService, que vuelve a
    // validar esa pertenencia igual.
    const organizer = await prisma.user.findUnique({ where: { id: sale.event.organization.ownerId } });
    if (!organizer || !organizer.clerkId) {
        logger.error(new Error("mercadopago confirmation: no se pudo resolver el organizador dueño para confirmar"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
        });
        return { ok: false, action: "transient_error", reason: "ORGANIZER_NOT_FOUND" };
    }

    try {
        const result = await confirmSaleService(organizer.clerkId, sale.id, {
            mercadoPagoPaymentId: normalizedPaymentId,
            confirmationSource: source,
        });
        logger.info("mercadopago confirmation: Sale confirmada", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            source,
            ticketCount: result.tickets.length,
        });
        return { ok: true, action: "confirmed", saleId: sale.id };
    } catch (error) {
        if (error?.code === "SALE_ALREADY_PROCESSED") {
            // Dos invocaciones del MISMO payment/Sale llegando en paralelo
            // (webhook y reconciliación, o dos reconciliaciones, o dos
            // webhooks) — confirmSaleService ya resuelve esta carrera de
            // forma atómica (updateMany...status:"PENDING"). Quien pierde
            // llega acá: no es un error, la otra invocación ya confirmó.
            logger.info("mercadopago confirmation: la Sale ya fue confirmada por otra invocación concurrente", {
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                source,
            });
            return { ok: true, action: "already_confirmed", saleId: sale.id };
        }
        if (error?.code === "INSUFFICIENT_STOCK") {
            // El pago se aprobó, pero para cuando se llegó a confirmar la
            // reserva ya había vencido y otra Sale se quedó con el último
            // lugar. Nunca se sobrevende: la Sale queda tal cual (PENDING,
            // sin Ticket/QR/email) — se deja constancia del paymentId en
            // `paymentRef` para que sea localizable en una reconciliación
            // futura, sin inventar ningún estado nuevo en SaleStatus.
            let paymentRefPersisted = true;
            try {
                await prisma.sale.update({ where: { id: sale.id }, data: { paymentRef: normalizedPaymentId } });
            } catch (updateError) {
                paymentRefPersisted = false;
                logger.error(updateError, {
                    context:
                        "mercadopago confirmation: no se pudo persistir paymentRef tras INSUFFICIENT_STOCK — el caso queda sin marca de reconciliación en Developer > Ventas, sólo en logs/alerta",
                    saleId: sale.id,
                    paymentId: normalizedPaymentId,
                    source,
                });
            }

            logger.error(error, {
                context: "mercadopago confirmation: payment aprobado pero sin stock disponible al confirmar — requiere reconciliación manual",
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                source,
                paymentRefPersisted,
            });

            const alertResult = await sendMercadoPagoReconciliationAlert({
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                eventId: sale.eventId,
            });
            if (!alertResult.sent) {
                logger.error(new Error("mercadopago confirmation: no se pudo enviar la alerta interna de reconciliación"), {
                    saleId: sale.id,
                    paymentId: normalizedPaymentId,
                    reason: alertResult.reason,
                });
            }

            return { ok: true, action: "approved_but_no_stock", saleId: sale.id };
        }
        if (error?.code === "P2002") {
            logger.error(error, {
                context: "mercadopago confirmation: mercadoPagoPaymentId ya estaba vinculado a otra Sale — invariante rota",
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                source,
            });

            const alertResult = await sendDeveloperAlert(DeveloperAlertType.FINANCIAL_INVARIANT_BROKEN, {
                reason: "PAYMENT_SALE_CONFLICT",
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                eventId: sale.eventId,
                organizationId: sale.event.organizationId,
                detail: "mercadoPagoPaymentId ya estaba vinculado a otra Sale (P2002)",
            });
            if (!alertResult.sent) {
                logger.error(new Error("mercadopago confirmation: no se pudo enviar la alerta interna de invariante financiera rota"), {
                    saleId: sale.id,
                    paymentId: normalizedPaymentId,
                    reason: alertResult.reason,
                });
            }

            return { ok: true, action: "unresolvable", reason: "PAYMENT_SALE_CONFLICT" };
        }
        throw error;
    }
}
