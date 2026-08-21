import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { buildArgentineWhatsappId } from "../utils/normalizeArgentinePhone.js";
import { getEmailConfig } from "../config/resend.js";
import { sendOrganizerWithdrawalRequestAlert } from "./email/sendOrganizerWithdrawalRequestAlert.service.js";
import { sendDeveloperAlert, DeveloperAlertType, tryClaimDeveloperAlertCooldown } from "./email/sendDeveloperAlert.service.js";
import { getDeveloperAlertConfigOrDefaults } from "./developerAlertConfig.service.js";

// Botón de arrepentimiento — registra una SOLICITUD, nunca un reembolso.
// NUNCA en este archivo: llamar a Mercado Pago, cambiar Sale.status,
// marcar Ticket REFUNDED, ni ninguna otra acción financiera — ver el
// informe de entrega, sección "NO refund automático".
const VALID_REASONS = new Set(["ARREPENTIMIENTO", "ERROR_COMPRA", "CAMBIO_EVENTO", "PROBLEMA_ENTRADAS", "OTRO"]);
const REASON_NOTE_MAX_LENGTH = 500;
const ACTIVE_STATUSES = ["REQUESTED", "CONTACTED"];

// Exportadas para tests unitarios puros (nunca tocan la base) — ver
// tests/withdrawalRequest.pure.test.js.
export function sanitizeReason(reason) {
    if (reason === undefined || reason === null || reason === "") return null;
    if (!VALID_REASONS.has(reason)) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ELIGIBLE, { details: ["Motivo inválido."] });
    return reason;
}

export function sanitizeReasonNote(reasonNote) {
    if (typeof reasonNote !== "string") return null;
    const trimmed = reasonNote.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, REASON_NOTE_MAX_LENGTH);
}

// Mismo mensaje prearmado descripto en el informe de entrega — NUNCA
// incluye DNI, OTP, tokens ni datos de otras compras, sólo el título del
// evento (dato ya público). Si Organization.phone no se puede interpretar
// con certeza como un número argentino real (ver buildArgentineWhatsappId
// — nunca adivina), no se ofrece WhatsApp: se cae al email público de la
// organización (Organization.email, campo obligatorio del modelo), nunca
// se inventa un contacto que no existe.
export function buildOrganizationContact(organization, eventTitle) {
    const waId = buildArgentineWhatsappId(organization.phone);
    const message = `Hola, realicé una solicitud relacionada con mi compra del evento ${eventTitle}. Quisiera comunicarme por la solicitud registrada.`;
    return {
        whatsappUrl: waId ? `https://wa.me/${waId}?text=${encodeURIComponent(message)}` : null,
        email: organization.email ?? null,
    };
}

// Paso 3 del flujo público — autorizado ÚNICAMENTE por conocer
// publicRecoveryToken (mismo modelo que confirm-by-buyer/status/pdf en
// todo el resto del proyecto, ver sale.controller.js). NUNCA confía en la
// lista de compras elegibles que vio el frontend en el paso 2: vuelve a
// resolver y revalidar todo desde la Sale real.
export async function createWithdrawalRequestService(token, { reason, reasonNote } = {}) {
    if (!token) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: token },
        include: {
            event: { include: { organization: true } },
            tickets: { where: { deletedAt: null }, select: { status: true } },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    // Elegibilidad TÉCNICA reautorizada server-side — mismo criterio que
    // findWithdrawalEligibleSales (sale.service.js), nunca el resultado
    // que el frontend recibió en el paso anterior.
    const isEligible = sale.status === "CONFIRMED" && sale.origin === "SALE" && sale.tickets.some((t) => t.status !== "REFUNDED");
    if (!isEligible) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ELIGIBLE);

    const sanitizedReason = sanitizeReason(reason);
    const sanitizedNote = sanitizeReasonNote(reasonNote);
    const organizationId = sale.event.organizationId;

    // Idempotencia concurrent-safe — el índice único parcial
    // (withdrawal_requests_active_per_sale, ver migration.sql) es lo que
    // realmente lo garantiza: si dos requests llegan casi al mismo tiempo,
    // Postgres sólo deja pasar UNA fila con status REQUESTED/CONTACTED
    // para esta Sale, la otra choca con P2002 y se trata como "ya existía"
    // en vez de reintentar o fallar.
    let withdrawalRequest;
    let alreadyExisted = false;
    try {
        withdrawalRequest = await prisma.withdrawalRequest.create({
            data: {
                saleId: sale.id,
                eventId: sale.eventId,
                organizationId,
                reason: sanitizedReason,
                reasonNote: sanitizedNote,
            },
        });
    } catch (err) {
        if (err?.code !== "P2002") throw err;
        alreadyExisted = true;
        withdrawalRequest = await prisma.withdrawalRequest.findFirst({
            where: { saleId: sale.id, status: { in: ACTIVE_STATUSES } },
            orderBy: { createdAt: "desc" },
        });
        // Defensivo — si por alguna razón no se encuentra (ej. se resolvió
        // entre el choque y esta lectura), no se inventa un resultado: se
        // deja propagar el error real en vez de fingir éxito.
        if (!withdrawalRequest) throw err;
    }

    const contact = buildOrganizationContact(sale.event.organization, sale.event.title);

    if (!alreadyExisted) {
        logger.info("createWithdrawalRequestService: solicitud registrada", {
            withdrawalRequestId: withdrawalRequest.id,
            saleId: sale.id,
            organizationId,
        });

        // Best-effort de punta a punta — nunca puede revertir ni afectar
        // la solicitud ya persistida arriba.
        try {
            const { frontendUrl } = getEmailConfig();
            const organizerEmail = sale.event.organization.email;
            if (organizerEmail) {
                const alertResult = await sendOrganizerWithdrawalRequestAlert({
                    to: organizerEmail,
                    eventTitle: sale.event.title,
                    reason: sanitizedReason,
                    reasonNote: sanitizedNote,
                    requestsUrl: `${frontendUrl}/organizador/solicitudes`,
                });
                if (!alertResult.sent) {
                    logger.warn("createWithdrawalRequestService: no se pudo enviar el aviso al organizador", {
                        withdrawalRequestId: withdrawalRequest.id,
                        reason: alertResult.reason,
                    });
                }
            }
        } catch (err) {
            logger.error(err, { context: "createWithdrawalRequestService: fallo inesperado avisando al organizador (no afecta la solicitud ya registrada)", withdrawalRequestId: withdrawalRequest.id });
        }

        // Radar Developer — volumen anormal, nunca una alerta por
        // solicitud individual (ver el informe de entrega). Misma
        // infraestructura de cooldown/config ya usada por 2C/2D/2E, nunca
        // un mecanismo nuevo.
        try {
            const config = await getDeveloperAlertConfigOrDefaults();
            const windowStart = new Date(Date.now() - config.withdrawalRequestsWindowHours * 60 * 60 * 1000);
            const count = await prisma.withdrawalRequest.count({
                where: { organizationId, createdAt: { gte: windowStart } },
            });
            if (count >= config.withdrawalRequestsWindowCount) {
                const claimed = await tryClaimDeveloperAlertCooldown(
                    `${DeveloperAlertType.WITHDRAWAL_REQUESTS_VOLUME_SPIKE}:${organizationId}`,
                    config.alertCooldownMinutes
                );
                if (claimed) {
                    const devAlertResult = await sendDeveloperAlert(DeveloperAlertType.WITHDRAWAL_REQUESTS_VOLUME_SPIKE, {
                        organizationId,
                        organizationName: sale.event.organization.name,
                        count,
                        windowHours: config.withdrawalRequestsWindowHours,
                        threshold: config.withdrawalRequestsWindowCount,
                    });
                    if (!devAlertResult.sent) {
                        logger.warn("createWithdrawalRequestService: no se pudo enviar la alerta Developer de volumen de solicitudes", { organizationId, reason: devAlertResult.reason });
                    }
                }
            }
        } catch (err) {
            logger.error(err, { context: "createWithdrawalRequestService: fallo inesperado evaluando la alerta Developer de volumen (no afecta la solicitud ya registrada)", organizationId });
        }
    }

    return {
        status: withdrawalRequest.status,
        alreadyExisted,
        eventTitle: sale.event.title,
        contact,
    };
}

// Panel Organizer > Solicitudes — aislamiento multi-organizador estricto:
// un ORGANIZER sólo ve las solicitudes de SU organización (resuelta por
// ownership, nunca por un organizationId que mande el cliente). Un
// DEVELOPER ve todas (mismo criterio platform-wide que el resto de
// Developer > *).
export async function listWithdrawalRequestsService(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    let organizationFilter = {};
    if (user.role !== "DEVELOPER") {
        const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
        if (!organization) return [];
        organizationFilter = { organizationId: organization.id };
    }

    const requests = await prisma.withdrawalRequest.findMany({
        where: organizationFilter,
        select: {
            id: true,
            status: true,
            reason: true,
            reasonNote: true,
            createdAt: true,
            resolvedAt: true,
            event: { select: { id: true, title: true } },
            sale: { select: { id: true, total: true, createdAt: true, tickets: { where: { deletedAt: null }, select: { id: true } } } },
        },
        orderBy: { createdAt: "desc" },
    });

    return requests.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        reasonNote: r.reasonNote,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        event: r.event,
        saleId: r.sale.id,
        saleTotal: Number(r.sale.total),
        salePurchasedAt: r.sale.createdAt,
        ticketCount: r.sale.tickets.length,
    }));
}

// Sólo transición de estado (REQUESTED -> CONTACTED -> RESOLVED, ver
// schema.prisma) — nunca toca Sale/Ticket, nunca dispara nada financiero.
// Mismo aislamiento que listWithdrawalRequestsService: un ORGANIZER nunca
// puede tocar una solicitud que no sea de su propia organización, sin
// importar qué id mande.
export async function updateWithdrawalRequestStatusService(clerkId, withdrawalRequestId, status) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    if (!["REQUESTED", "CONTACTED", "RESOLVED"].includes(status)) {
        throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ELIGIBLE, { details: ["Estado inválido."] });
    }

    const existing = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalRequestId } });
    if (!existing) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    if (user.role !== "DEVELOPER") {
        const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
        if (!organization || organization.id !== existing.organizationId) {
            // Mismo criterio "no distinguir de no existe" que el resto del
            // proyecto usa para aislamiento entre organizaciones.
            throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);
        }
    }

    let updated;
    try {
        updated = await prisma.withdrawalRequest.update({
            where: { id: withdrawalRequestId },
            data: { status, resolvedAt: status === "RESOLVED" ? new Date() : existing.resolvedAt },
        });
    } catch (err) {
        // Reabrir una solicitud RESOLVED de vuelta a REQUESTED/CONTACTED
        // puede chocar contra el índice único parcial si mientras tanto ya
        // existe OTRA solicitud activa para la misma Sale (ver
        // migration.sql) — caso raro, pero se traduce a un error claro en
        // vez de dejar pasar un 500 crudo.
        if (err?.code === "P2002") {
            throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ELIGIBLE, {
                details: ["Ya existe otra solicitud activa para esta compra."],
            });
        }
        throw err;
    }

    logger.info("updateWithdrawalRequestStatusService completed", { withdrawalRequestId, status, updatedBy: user.id });
    return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt };
}
