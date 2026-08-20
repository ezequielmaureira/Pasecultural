import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { getMercadoPagoPayment } from "./mercadoPago.service.js";
import { getValidMercadoPagoAccessTokenForConnection } from "./mercadoPagoConnection.service.js";
import { confirmSaleService } from "./sale.service.js";
import { sendMercadoPagoReconciliationAlert } from "./email/sendMercadoPagoReconciliationAlert.service.js";
import { round2 } from "../utils/money.js";

// MP-3 — la notificación de Mercado Pago NUNCA es la fuente de verdad: sólo
// sirve para saber QUÉ payment id consultar. Todo lo que de verdad importa
// (status, monto, moneda, a quién pertenece) sale de una consulta GET
// server-to-server (mercadoPago.service.js#getMercadoPagoPayment), nunca
// del body/headers de esta notificación. Ver el informe de entrega de MP-3
// para el razonamiento completo de seguridad.

const APPROVED_STATUS = "approved";
// Bug fix (reintentos de Checkout Pro) — terminal SÓLO para ESTE intento de
// pago puntual, NUNCA para la Sale: Checkout Pro ofrece "pagar con otro
// medio" sobre la MISMA preference/external_reference después de un
// rechazo, así que un rejected/cancelled individual nunca debe cancelar la
// Sale ni liberar su reserva de stock — eso rompía exactamente el caso
// real rejected→approved (el buyer pagaba de verdad en el segundo intento
// y la Sale ya estaba CANCELLED, sin ticket). La Sale sigue PENDING y
// sigue pudiendo recibir un payment distinto después. El único mecanismo
// de abandono real sigue siendo el TTL de stockReservedUntil que ya existe
// (ver STOCK_RESERVATION_TTL_MS, sale.service.js) — nunca se inventó uno
// nuevo acá.
const PAYMENT_ATTEMPT_FAILED_STATUSES = new Set(["rejected", "cancelled"]);
// Reversión sobre un pago que YA fue aprobado — MP-3 no deshace nada (fuera
// de alcance, ver el informe), sólo deja constancia.
const REVERSAL_STATUSES = new Set(["refunded", "charged_back"]);

// outcome.ok === false SÓLO para fallas transitorias (el controller debe
// devolver 500 para que Mercado Pago reintente más tarde, documentado
// oficialmente). Todo lo demás — incluidos los casos "no se pudo
// correlacionar", "pago no aprobado todavía", "ya estaba confirmado" — es
// outcome.ok === true: la notificación en sí se procesó correctamente,
// aunque no haya nada más que hacer (o nada que se pueda hacer con
// seguridad). Reintentar esos casos no cambiaría nada.
export async function processMercadoPagoWebhookNotification({ type, dataId, bodyUserId }) {
    if (type !== "payment") {
        logger.info("mercadopago webhook: topic ignorado", { type });
        return { ok: true, action: "ignored_topic" };
    }
    if (!dataId) {
        logger.warn("mercadopago webhook: notificación de tipo payment sin data.id");
        return { ok: true, action: "unresolvable", reason: "MISSING_DATA_ID" };
    }

    const normalizedPaymentId = String(dataId);

    // 1) Si este payment id ya está vinculado a una Sale, se reusa esa
    // vinculación SÓLO para resolver más rápido con qué credencial
    // consultar (nunca para saltear la consulta en sí): Mercado Pago puede
    // mandar varias notificaciones distintas para el mismo payment id a lo
    // largo de su vida (creado -> aprobado -> más tarde reembolsado), y
    // cortar acá antes de volver a consultar dejaría pasar por alto un
    // reembolso/contracargo posterior sobre un payment ya confirmado (ver
    // el informe de MP-3, sección Refunds/Chargebacks). El "no hay nada
    // nuevo que hacer" para una notificación genuinamente repetida se
    // resuelve más abajo, después de mirar el status actual del payment.
    const alreadyLinked = await prisma.sale.findUnique({ where: { mercadoPagoPaymentId: normalizedPaymentId } });
    let connection = null;
    if (alreadyLinked) {
        connection = await prisma.mercadoPagoConnection.findFirst({
            where: { organization: { events: { some: { id: alreadyLinked.eventId } } } },
        });
    }

    // 2) Resolver con qué credencial intentar la consulta. bodyUserId viene
    // del body de la notificación — NUNCA cubierto por x-signature (el
    // manifest firmado sólo incluye data.id+request-id+ts, ver
    // mercadoPagoWebhookSignature.js) — así que NUNCA se usa como
    // autorización, sólo como pista de enrutamiento: si la pista es
    // incorrecta o fue manipulada, la propia consulta a Mercado Pago
    // (scoped a la cuenta del token elegido) va a fallar sola. La verdad
    // siempre sale de esa respuesta, nunca de este dato.
    if (!connection && bodyUserId) {
        // mercadoPagoUserId NO es @unique en el schema (nada impide, en
        // principio, que la misma cuenta de Mercado Pago autorice a más de
        // una Organization) — es sólo una pista de enrutamiento, nunca
        // autorización, así que findFirst alcanza: si la conexión elegida
        // no es la correcta, el chequeo de collector_id de más abajo la
        // descarta igual.
        connection = await prisma.mercadoPagoConnection.findFirst({ where: { mercadoPagoUserId: String(bodyUserId) } });
    }
    if (!connection) {
        logger.warn("mercadopago webhook: no se pudo resolver ninguna organización candidata para este payment", {
            paymentId: normalizedPaymentId,
            hasBodyUserId: Boolean(bodyUserId),
        });
        return { ok: true, action: "unresolvable", reason: "NO_CANDIDATE_CONNECTION" };
    }

    // Bug fix (desconexión de Mercado Pago) — SIEMPRE el token de ESTA
    // fila `connection` ya resuelta (por mercadoPagoUserId o por la Sale
    // ya vinculada), NUNCA "la conexión ACTIVE actual de la Organization":
    // si la Organization desconectó esta cuenta y conectó otra distinta
    // entre el cobro y este webhook, la ACTIVE actual ya no es la cuenta
    // que hizo este payment — usar getValidMercadoPagoAccessTokenForOrganization
    // acá reintroduciría exactamente el bug que este cambio corrige (ver
    // mercadoPagoConnection.service.js).
    const accessToken = await getValidMercadoPagoAccessTokenForConnection(connection.id);
    const payment = await getMercadoPagoPayment({ accessToken, paymentId: normalizedPaymentId });

    if (!payment.success) {
        const transient =
            payment.error === "TIMEOUT" ||
            payment.error === "NETWORK_ERROR" ||
            (typeof payment.httpStatus === "number" && payment.httpStatus >= 500);
        logger.warn("mercadopago webhook: fallo al consultar el payment", {
            paymentId: normalizedPaymentId,
            reason: payment.error,
            transient,
        });
        return transient
            ? { ok: false, action: "transient_error", reason: payment.error }
            : { ok: true, action: "unresolvable", reason: payment.error };
    }

    // Defensa adicional: el fetch ya está scoped por el propio token de
    // Mercado Pago a la cuenta que lo emitió, pero nunca se asume — se
    // confirma explícito que el collector del payment es el mismo que el
    // de la conexión resuelta.
    if (payment.collectorId && payment.collectorId !== connection.mercadoPagoUserId) {
        logger.error(new Error("mercadopago webhook: collector_id del payment no coincide con la conexión resuelta"), {
            paymentId: normalizedPaymentId,
            resolvedOrganizationId: connection.organizationId,
        });
        return { ok: true, action: "unresolvable", reason: "COLLECTOR_MISMATCH" };
    }

    if (!payment.externalReference) {
        logger.warn("mercadopago webhook: payment sin external_reference", { paymentId: normalizedPaymentId });
        return { ok: true, action: "unresolvable", reason: "MISSING_EXTERNAL_REFERENCE" };
    }

    // 3) Correlación PAYMENT -> Sale: exclusivamente por
    // mercadoPagoExternalReference (nunca publicRecoveryToken, nunca
    // organizationId del cliente, nunca email). @unique en Sale, así que
    // esto sólo puede resolver 0 o 1 fila — nunca "más de una" (ver el
    // informe de entrega de MP-3).
    const sale = await prisma.sale.findUnique({
        where: { mercadoPagoExternalReference: payment.externalReference },
        include: { event: { include: { organization: true } } },
    });
    if (!sale) {
        logger.warn("mercadopago webhook: ningún Sale corresponde a este external_reference", { paymentId: normalizedPaymentId });
        return { ok: true, action: "unresolvable", reason: "SALE_NOT_FOUND" };
    }

    if (sale.paymentMethod !== "MERCADO_PAGO") {
        logger.error(new Error("mercadopago webhook: external_reference coincide con una Sale que no es de Mercado Pago"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
        });
        return { ok: true, action: "unresolvable", reason: "SALE_NOT_MERCADOPAGO" };
    }
    if (sale.event.organizationId !== connection.organizationId) {
        logger.error(
            new Error("mercadopago webhook: la Sale resuelta pertenece a otra organización que la usada para consultar el payment"),
            { saleId: sale.id, paymentId: normalizedPaymentId }
        );
        return { ok: true, action: "unresolvable", reason: "ORGANIZATION_MISMATCH" };
    }

    // MP-5 — reversión sobre un payment ya aprobado: nunca se deshace el
    // cobro en sí (Mercado Pago ya lo hizo), nunca se toca Sale.status ni
    // stock (fuera de alcance, ver informe de entrega de MP-5), pero SÍ se
    // invalida el acceso al evento: los Ticket ACTIVE de esta Sale pasan a
    // REFUNDED, que el Scanner ya rechaza exactamente igual que CANCELLED
    // (resolveScanOutcome, scanner.service.js — sin cambios ahí). Sólo
    // aplica si la Sale llegó a confirmarse; si nunca se confirmó no hay
    // Ticket que invalidar. El updateMany condicionado a status: "ACTIVE"
    // es el mismo patrón atómico que el resto del archivo — por eso una
    // notificación repetida (retry/redelivery, o refunded seguido de
    // charged_back para el mismo payment) nunca vuelve a tocar nada: la
    // segunda vez no encuentra ningún Ticket ACTIVE para actualizar.
    if (REVERSAL_STATUSES.has(payment.status)) {
        let ticketsRefunded = 0;
        if (sale.status === "CONFIRMED") {
            const updated = await prisma.ticket.updateMany({
                where: { saleId: sale.id, status: "ACTIVE" },
                data: { status: "REFUNDED" },
            });
            ticketsRefunded = updated.count;
        }
        logger.error(new Error(`mercadopago webhook: payment revertido (${payment.status}) recibido`), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            saleStatus: sale.status,
            ticketsRefunded,
        });
        return { ok: true, action: "reversal_acknowledged", saleId: sale.id, ticketsRefunded };
    }

    if (sale.status === "CONFIRMED") {
        logger.info("mercadopago webhook: la Sale ya estaba CONFIRMED", { saleId: sale.id, paymentId: normalizedPaymentId });
        return { ok: true, action: "already_confirmed", saleId: sale.id };
    }

    if (sale.status !== "PENDING") {
        // CANCELLED/EXPIRED — la reserva ya no es válida, nunca se confirma.
        logger.warn("mercadopago webhook: la Sale ya no está PENDING, no se confirma", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            saleStatus: sale.status,
        });
        return { ok: true, action: "unresolvable", reason: `SALE_STATUS_${sale.status}` };
    }

    if (PAYMENT_ATTEMPT_FAILED_STATUSES.has(payment.status)) {
        // Bug fix (reintentos de Checkout Pro) — este intento puntual
        // falló, pero la Sale sigue PENDING y su reserva de stock (TTL,
        // ver sale.service.js) queda exactamente igual: nunca se escribe
        // nada acá. Checkout Pro puede seguir ofreciendo "pagar con otro
        // medio" sobre la MISMA preference/external_reference, y un
        // payment distinto (nuevo dataId) puede llegar aprobado después —
        // ese caso se resuelve normalmente la próxima vez que entra este
        // mismo external_reference. Idempotente por construcción: no
        // muta nada, así que da igual cuántas veces se repita esta misma
        // notificación.
        logger.info("mercadopago webhook: intento de pago individual terminó negativo, la Sale sigue PENDING", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            paymentStatus: payment.status,
            saleStatus: sale.status,
        });
        return { ok: true, action: "payment_attempt_failed", saleId: sale.id };
    }

    if (payment.status !== APPROVED_STATUS) {
        // pending / in_process / in_mediation / cualquier otro no
        // reconocido — válido, no es un error: todavía no hay nada que
        // confirmar. Una notificación futura para este mismo payment,
        // cuando cambie de estado, se procesa de nuevo desde cero.
        logger.info("mercadopago webhook: payment todavía no aprobado", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            paymentStatus: payment.status,
        });
        return { ok: true, action: "not_approved", saleId: sale.id, paymentStatus: payment.status };
    }

    // A partir de acá, payment.status === "approved" — validaciones
    // económicas EXACTAS antes de confirmar nada. Mismo criterio de
    // redondeo que el resto del proyecto (round2, ver utils/money.js) —
    // nunca una comparación flotante directa.
    const expectedAmount = round2(sale.total);
    const paidAmount = round2(payment.transactionAmount);
    if (paidAmount !== expectedAmount) {
        logger.error(new Error("mercadopago webhook: transaction_amount no coincide con Sale.total"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            expectedAmount,
            paidAmount,
        });
        return { ok: true, action: "unresolvable", reason: "AMOUNT_MISMATCH" };
    }
    if (payment.currencyId !== "ARS") {
        logger.error(new Error("mercadopago webhook: currency_id inesperado"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            currencyId: payment.currencyId,
        });
        return { ok: true, action: "unresolvable", reason: "CURRENCY_MISMATCH" };
    }

    // Mismo mecanismo que confirmSaleByBuyer (sale.controller.js) ya usa
    // para el pago manual/simulado — "impersona" al organizador dueño de
    // la organización para poder llamar a confirmSaleService, que vuelve a
    // validar esa pertenencia igual. Nunca se toca esa validación.
    const organizer = await prisma.user.findUnique({ where: { id: sale.event.organization.ownerId } });
    if (!organizer || !organizer.clerkId) {
        logger.error(new Error("mercadopago webhook: no se pudo resolver el organizador dueño para confirmar"), {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
        });
        return { ok: false, action: "transient_error", reason: "ORGANIZER_NOT_FOUND" };
    }

    try {
        const result = await confirmSaleService(organizer.clerkId, sale.id, { mercadoPagoPaymentId: normalizedPaymentId });
        logger.info("mercadopago webhook: Sale confirmada", {
            saleId: sale.id,
            paymentId: normalizedPaymentId,
            ticketCount: result.tickets.length,
        });
        return { ok: true, action: "confirmed", saleId: sale.id };
    } catch (error) {
        if (error?.code === "SALE_ALREADY_PROCESSED") {
            // Dos webhooks del MISMO payment (o del mismo Sale) llegando en
            // paralelo: confirmSaleService ya resuelve esta carrera de forma
            // atómica (updateMany...status:"PENDING", ver sale.service.js)
            // — quien pierde llega acá. No es un error: la otra invocación
            // ya confirmó la venta, así que ésta también termina en éxito,
            // sin reintento de Mercado Pago necesario.
            logger.info("mercadopago webhook: la Sale ya fue confirmada por otra invocación concurrente", {
                saleId: sale.id,
                paymentId: normalizedPaymentId,
            });
            return { ok: true, action: "already_confirmed", saleId: sale.id };
        }
        if (error?.code === "INSUFFICIENT_STOCK") {
            // El caso "webhook tardío" del informe de MP-3 (sección 17): el
            // pago se aprobó, pero para cuando llegó esta notificación la
            // reserva ya había vencido y otra Sale se quedó con el último
            // lugar. Nunca se sobrevende: la Sale queda tal cual (PENDING,
            // sin Ticket/QR/email) — se deja constancia del paymentId en
            // `paymentRef` (campo ya existente en el schema desde antes de
            // MP-1, nunca usado hasta ahora) para que sea localizable en
            // una reconciliación manual futura, SIN inventar ningún estado
            // nuevo en SaleStatus. La condición de reconciliación que usa
            // Developer > Ventas es exactamente `status=PENDING AND
            // paymentRef != null` (ver developerSales.service.js) — por eso
            // este update ya NO traga su error en silencio (auditoría,
            // "Corregir persistencia de paymentRef"): si falla, hace falta
            // saberlo explícito en vez de asumir que el caso quedó marcado.
            let paymentRefPersisted = true;
            try {
                await prisma.sale.update({ where: { id: sale.id }, data: { paymentRef: normalizedPaymentId } });
            } catch (updateError) {
                paymentRefPersisted = false;
                logger.error(updateError, {
                    context:
                        "mercadopago webhook: no se pudo persistir paymentRef tras INSUFFICIENT_STOCK — el caso queda sin marca de reconciliación en Developer > Ventas, sólo en logs/alerta",
                    saleId: sale.id,
                    paymentId: normalizedPaymentId,
                });
            }

            logger.error(error, {
                context: "mercadopago webhook: payment aprobado pero sin stock disponible al confirmar — requiere reconciliación manual",
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                paymentRefPersisted,
            });

            // Best-effort, nunca lanza (ver sendMercadoPagoReconciliationAlert):
            // ni un fallo de Resend ni la falta de MERCADOPAGO_RECONCILIATION_ALERT_EMAIL
            // pueden hacer fallar este webhook — el log de arriba ya deja
            // constancia del incidente aunque la alerta no salga.
            const alertResult = await sendMercadoPagoReconciliationAlert({
                saleId: sale.id,
                paymentId: normalizedPaymentId,
                eventId: sale.eventId,
            });
            if (!alertResult.sent) {
                logger.error(new Error("mercadopago webhook: no se pudo enviar la alerta interna de reconciliación"), {
                    saleId: sale.id,
                    paymentId: normalizedPaymentId,
                    reason: alertResult.reason,
                });
            }

            return { ok: true, action: "approved_but_no_stock", saleId: sale.id };
        }
        if (error?.code === "P2002") {
            logger.error(error, {
                context: "mercadopago webhook: mercadoPagoPaymentId ya estaba vinculado a otra Sale — invariante rota",
                saleId: sale.id,
                paymentId: normalizedPaymentId,
            });
            return { ok: true, action: "unresolvable", reason: "PAYMENT_SALE_CONFLICT" };
        }
        throw error;
    }
}
