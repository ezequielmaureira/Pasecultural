import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { confirmMercadoPagoPaymentIfEligible } from "./mercadoPagoPaymentConfirmation.service.js";

// MP-3 — la notificación de Mercado Pago NUNCA es la fuente de verdad: sólo
// sirve para saber QUÉ payment id consultar. Todo lo que de verdad importa
// (status, monto, moneda, a quién pertenece) sale de una consulta GET
// server-to-server, nunca del body/headers de esta notificación.
//
// Ronda de reconciliación — este archivo quedó reducido a un wrapper
// delgado: parsea la notificación (`type`/`dataId`/`bodyUserId`), resuelve
// el ÚNICO dato específico de "vino como webhook" (una conexión candidata a
// partir de `bodyUserId`, pista de enrutamiento nunca autorización — el
// manifest firmado por x-signature nunca cubre este campo, ver
// mercadoPagoWebhookSignature.js), y delega TODA la validación/confirmación
// a confirmMercadoPagoPaymentIfEligible (mercadoPagoPaymentConfirmation.
// service.js), compartida con mercadoPagoReconciliation.service.js. Cero
// lógica financiera propia de acá en más — ver el informe de entrega de
// esta ronda para el razonamiento completo de la extracción.
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

    // mercadoPagoUserId NO es @unique en el schema (nada impide, en
    // principio, que la misma cuenta de Mercado Pago autorice a más de una
    // Organization) — es sólo una pista de enrutamiento, nunca
    // autorización, así que findFirst alcanza: si la conexión elegida no
    // es la correcta, el chequeo de collector_id dentro del núcleo
    // compartido la descarta igual.
    let candidateConnectionId = null;
    if (bodyUserId) {
        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { mercadoPagoUserId: String(bodyUserId) } });
        candidateConnectionId = connection?.id ?? null;
    }

    return confirmMercadoPagoPaymentIfEligible({ paymentId: normalizedPaymentId, candidateConnectionId, source: "WEBHOOK" });
}
