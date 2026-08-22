import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { buildArgentineWhatsappId } from "../utils/normalizeArgentinePhone.js";
import { getEmailConfig } from "../config/resend.js";
import { sendOrganizerNotification, OrganizerNotificationType } from "./email/sendOrganizerNotification.service.js";
import { sendDeveloperAlert, DeveloperAlertType, tryClaimDeveloperAlertCooldown } from "./email/sendDeveloperAlert.service.js";
import { getDeveloperAlertConfigOrDefaults } from "./developerAlertConfig.service.js";

// Botón de arrepentimiento — registra una SOLICITUD, nunca un reembolso.
// NUNCA en este archivo: llamar a Mercado Pago, cambiar Sale.status,
// marcar Ticket REFUNDED, ni ninguna otra acción financiera — ver el
// informe de entrega, sección "NO refund automático".
const VALID_REASONS = new Set(["ARREPENTIMIENTO", "ERROR_COMPRA", "CAMBIO_EVENTO", "PROBLEMA_ENTRADAS", "OTRO"]);
const REASON_NOTE_MAX_LENGTH = 500;
const ACTIVE_STATUSES = ["REQUESTED", "CONTACTED"];

// Ventana informativa post-devolución — ver getSaleStatusService
// (sale.service.js), que es quien realmente la aplica. Sólo UI: nunca
// reactiva el ticket, nunca reabre la solicitud, nunca revive el QR.
export const WITHDRAWAL_RETURN_VISIBILITY_HOURS = 24;

// Discriminador INEQUÍVOCO de "este ACTIVE->CANCELLED fue un ticket
// devuelto por el botón de arrepentimiento" — nunca una cancelación
// administrativa común (ticketAdmin.service.js#cancelTicketService usa el
// mismo action=CANCEL/actorType=ORGANIZER, así que ninguno de esos dos
// campos alcanza por sí solo para distinguir un motivo del otro). Se guarda
// en TicketAuditLog.metadata (Json? ya existente, reservado para esto,
// nunca usado por ningún otro caller hoy) — no hace falta ningún campo de
// schema nuevo.
const WITHDRAWAL_RETURN_AUDIT_SOURCE = "WITHDRAWAL_REQUEST_RETURN";

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
// evento (dato ya público). Verificación de teléfono/WhatsApp de
// Organización — el WhatsApp SOLO se ofrece si Organization.phoneVerifiedAt
// tiene valor (el número pasó de verdad por el mecanismo de confirmación
// real de Meta, ver organizationPhoneVerification.service.js); nunca un
// teléfono simplemente presente/con formato válido, y nunca un
// pendingPhone en curso (ese campo ni siquiera vive en Organization, así
// que no hay forma de que se filtre acá por accidente). Si no hay teléfono
// verificado, se cae al email público de la organización
// (Organization.email, campo obligatorio del modelo), nunca se inventa un
// contacto que no existe.
export function buildOrganizationContact(organization, eventTitle) {
    const waId = organization.phoneVerifiedAt ? buildArgentineWhatsappId(organization.phone) : null;
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
            function: { select: { date: true, venue: true } },
            tickets: { where: { deletedAt: null }, select: { status: true } },
            items: { select: { quantity: true, ticketType: { select: { name: true } } } },
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
        // la solicitud ya persistida arriba. OBLIGATORIA: nunca depende de
        // OrganizerNotificationSettings (ver el informe de entrega,
        // "Alertas obligatorias") — generalizada acá desde
        // sendOrganizerWithdrawalRequestAlert.service.js (retirado).
        try {
            const { frontendUrl } = getEmailConfig();
            const organizerEmail = sale.event.organization.email;
            if (organizerEmail) {
                const ticketCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                const ticketSummary = sale.items.map((item) => `${item.quantity}x ${item.ticketType.name}`).join(", ");
                const alertResult = await sendOrganizerNotification(OrganizerNotificationType.WITHDRAWAL_REQUEST, {
                    to: organizerEmail,
                    eventTitle: sale.event.title,
                    functionDate: sale.function.date,
                    venue: sale.function.venue,
                    reason: sanitizedReason,
                    reasonNote: sanitizedNote,
                    ticketCount,
                    ticketSummary,
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

// Sólo transición REQUESTED<->CONTACTED ("en gestión") — nunca toca Sale/
// Ticket, nunca dispara nada financiero. Deliberadamente YA NO acepta
// RESOLVED como destino (ver el comentario del enum en schema.prisma):
// RESOLVED sólo puede alcanzarse mediante returnWithdrawalRequestTicketsService,
// que SÍ cancela el/los Ticket correspondiente(s) en la misma transacción
// — así RESOLVED significa siempre lo mismo (hubo una devolución de
// entrada real), nunca un clic administrativo sin acción real detrás.
// Tampoco acepta DISMISSED: eso es EXCLUSIVAMENTE una decisión del
// comprador (ver dismissWithdrawalRequestService), nunca algo que el
// organizador pueda hacer sobre la solicitud de otra persona. Mismo
// aislamiento que listWithdrawalRequestsService: un ORGANIZER nunca puede
// tocar una solicitud que no sea de su propia organización, sin importar
// qué id mande.
// Resolución de ownership compartida — ORGANIZER sólo puede tocar
// solicitudes de SU organización (nunca por un organizationId que mande
// el cliente, siempre derivado del owner real); DEVELOPER ve/toca
// cualquiera (mismo criterio platform-wide que el resto de Developer > *).
// "No existe" y "existe pero no es tuya" responden EXACTAMENTE igual
// (WITHDRAWAL_REQUEST_SALE_NOT_FOUND) — nunca se distingue cuál de los dos
// casos ocurrió, mismo patrón que el resto del proyecto.
async function resolveOwnedWithdrawalRequestOrThrow(clerkId, withdrawalRequestId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const existing = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalRequestId } });
    if (!existing) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    if (user.role !== "DEVELOPER") {
        const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
        if (!organization || organization.id !== existing.organizationId) {
            throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);
        }
    }

    return { user, withdrawalRequest: existing };
}

export async function updateWithdrawalRequestStatusService(clerkId, withdrawalRequestId, status) {
    if (!["REQUESTED", "CONTACTED"].includes(status)) {
        throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ELIGIBLE, { details: ["Estado inválido."] });
    }

    const { user } = await resolveOwnedWithdrawalRequestOrThrow(clerkId, withdrawalRequestId);

    // resolvedAt nunca se toca acá: este endpoint sólo alterna
    // REQUESTED<->CONTACTED (validado arriba), nunca llega a RESOLVED — ver
    // returnWithdrawalRequestTicketsService para el único camino real que
    // marca resolvedAt.
    let updated;
    try {
        updated = await prisma.withdrawalRequest.update({
            where: { id: withdrawalRequestId },
            data: { status },
        });
    } catch (err) {
        // Reabrir una solicitud desde otro estado hacia REQUESTED/CONTACTED
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

// ==================================================================
// Cierre del ciclo — "Descartar solicitud" (comprador) y "Marcar entrada
// como devuelta" (organizador). Ver el informe de entrega, sección
// "arquitectura encontrada": WithdrawalRequest apunta a la Sale completa
// (nunca a un Ticket puntual) porque una Sale puede tener varias entradas
// y el comprador siempre elige la COMPRA, nunca una entrada individual —
// por eso "qué entrada puntual se devuelve" lo decide el ORGANIZADOR recién
// al resolver (ya negoció el acuerdo real por fuera del sistema), nunca el
// comprador ni un cálculo automático.
// ==================================================================

// Autorizado ÚNICAMENTE por conocer el saleToken (publicRecoveryToken de
// la Sale) — mismo modelo que createWithdrawalRequestService, nunca por
// sesión. Idempotente A PROPÓSITO (sección "Descartar solicitud" del
// pedido): si no hay ninguna solicitud ACTIVA para descartar (ya se
// descartó, ya se resolvió, o nunca existió), no es un error — el estado
// final deseado ("nada pendiente") ya se cumple. El claim (updateMany
// condicionado al status todavía activo) es lo que hace esto concurrent-
// safe: dos descartes simultáneos nunca compiten, sólo uno gana el count=1
// real. NUNCA toca Sale/Ticket — descartar es exclusivamente sobre la
// solicitud misma (ver el informe de entrega, sección 14).
export async function dismissWithdrawalRequestService(token) {
    if (!token) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({ where: { publicRecoveryToken: token }, select: { id: true, deletedAt: true } });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_SALE_NOT_FOUND);

    const claim = await prisma.withdrawalRequest.updateMany({
        where: { saleId: sale.id, status: { in: ACTIVE_STATUSES } },
        data: { status: "DISMISSED" },
    });

    if (claim.count > 0) {
        logger.info("dismissWithdrawalRequestService: solicitud descartada", { saleId: sale.id });
    }
    // dismissed:false es un no-op seguro (nunca un error) — ver el
    // comentario de arriba.
    return { dismissed: claim.count > 0 };
}

// Panel Organizer — detalle de las entradas de la Sale detrás de una
// solicitud puntual, para que el organizador elija cuál/cuáles marcar como
// devueltas. Sólo lectura. Mismo aislamiento que el resto de este archivo.
export async function getWithdrawalRequestTicketsService(clerkId, withdrawalRequestId) {
    const { withdrawalRequest } = await resolveOwnedWithdrawalRequestOrThrow(clerkId, withdrawalRequestId);

    const tickets = await prisma.ticket.findMany({
        where: { saleId: withdrawalRequest.saleId, deletedAt: null },
        select: { id: true, ticketNumber: true, status: true, ticketType: { select: { name: true } } },
        orderBy: { sequence: "asc" },
    });

    return {
        id: withdrawalRequest.id,
        status: withdrawalRequest.status,
        tickets: tickets.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber, status: t.status, ticketTypeName: t.ticketType.name })),
    };
}

// "Marcar entrada como devuelta" — la ÚNICA forma de alcanzar RESOLVED
// desde esta ronda en adelante (ver el comentario del enum en
// schema.prisma). Reutiliza EXACTAMENTE el mismo criterio que
// ticketAdmin.service.js#cancelTicketService (ACTIVE -> CANCELLED,
// TicketAuditLog action=CANCEL, actorType=ORGANIZER) — nunca reimplementa
// una invalidación paralela: confirmScanService/scanner.service.js ya
// rechazan un ticket CANCELLED (nunca REFUNDED, reservado exclusivamente
// para reversiones reales de Mercado Pago confirmadas por webhook — ver
// mercadoPagoWebhook.service.js), y functionCapacity.service.js#SOLD_TICKET_STATUSES
// ya excluye CANCELLED de "ocupa stock" — la disponibilidad se libera SOLA,
// nunca un `stock = stock + 1` manual.
//
// Atómico y concurrency-safe: reclama la solicitud PRIMERO (updateMany
// condicionado a que siga REQUESTED/CONTACTED, mismo patrón CAS que el
// resto del proyecto) DENTRO de la misma transacción que cancela los
// tickets — si el claim no cuenta 1 (otra resolución/concurrencia ya la
// resolvió), la transacción entera aborta sin tocar ningún ticket; si los
// ticketIds no son válidos (no pertenecen a esta Sale, o alguno ya no está
// ACTIVE — ej. ya usado/cancelado), también aborta sin dejar la solicitud
// a mitad de camino. Nunca puede quedar "solicitud RESOLVED + ticket
// activo" ni "ticket cancelado + solicitud todavía pendiente".
export async function returnWithdrawalRequestTicketsService(clerkId, withdrawalRequestId, ticketIds) {
    const { user, withdrawalRequest } = await resolveOwnedWithdrawalRequestOrThrow(clerkId, withdrawalRequestId);

    const ids = Array.isArray(ticketIds) ? [...new Set(ticketIds.filter((id) => typeof id === "string" && id))] : [];
    if (ids.length === 0) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_TICKETS_REQUIRED);

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
        const claim = await tx.withdrawalRequest.updateMany({
            where: { id: withdrawalRequestId, status: { in: ACTIVE_STATUSES } },
            data: { status: "RESOLVED", resolvedAt: now },
        });
        if (claim.count === 0) return { claimed: false };

        // Nunca se confía en que el frontend haya mandado ids válidos —
        // sólo tickets de ESTA MISMA Sale, sin borrar, cuentan.
        const tickets = await tx.ticket.findMany({
            where: { id: { in: ids }, saleId: withdrawalRequest.saleId, deletedAt: null },
            select: { id: true, status: true },
        });
        if (tickets.length !== ids.length) throw new AppError(ErrorCodes.TICKET_NOT_FOUND);
        if (tickets.some((t) => t.status !== "ACTIVE")) throw new AppError(ErrorCodes.TICKET_INVALID_TRANSITION);

        await tx.ticket.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
        await tx.ticketAuditLog.createMany({
            data: ids.map((ticketId) => ({
                ticketId,
                action: "CANCEL",
                fromStatus: "ACTIVE",
                toStatus: "CANCELLED",
                actorType: "ORGANIZER",
                actorId: user.id,
                reason: `Botón de arrepentimiento — entrada devuelta (solicitud ${withdrawalRequestId})`,
                // metadata.source es lo único que getWithdrawalReturnInfoForTickets
                // realmente lee para decidir "esto fue una devolución de este
                // flujo" — el `reason` de arriba es sólo texto para humanos,
                // nunca se parsea.
                metadata: { source: WITHDRAWAL_RETURN_AUDIT_SOURCE, withdrawalRequestId },
            })),
        });

        return { claimed: true };
    });

    if (!result.claimed) throw new AppError(ErrorCodes.WITHDRAWAL_REQUEST_NOT_ACTIVE);

    logger.info("returnWithdrawalRequestTicketsService completed", { withdrawalRequestId, ticketIds: ids, updatedBy: user.id });
    return { id: withdrawalRequestId, status: "RESOLVED", resolvedAt: now, returnedTicketIds: ids };
}

// Extensión "ver mis entradas" (ventana de 24h) — resuelve, para un lote de
// tickets YA sabidos CANCELLED, cuál de ellos llegó a ese estado por una
// devolución de ESTE flujo (nunca por ticketAdmin.service.js#cancelTicketService
// u otro motivo administrativo). Se apoya en que TicketAuditLog es
// append-only: la fila MÁS RECIENTE con toStatus=CANCELLED es, por
// construcción, la transición que produjo el estado CANCELLED actual del
// ticket (si luego se rehabilitara y se volviera a cancelar por otro medio,
// esa nueva fila sería la más reciente y ganaría correctamente). Devuelve un
// Map<ticketId, Date|null> — null cuando el ticket está CANCELLED pero NO
// por este flujo (nunca se inventa un returnedAt ahí).
export async function getWithdrawalReturnInfoForTickets(ticketIds) {
    const result = new Map();
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) return result;

    const logs = await prisma.ticketAuditLog.findMany({
        where: { ticketId: { in: ticketIds }, toStatus: "CANCELLED" },
        orderBy: { createdAt: "desc" },
        select: { ticketId: true, createdAt: true, metadata: true },
    });

    for (const log of logs) {
        if (result.has(log.ticketId)) continue; // ya se guardó la transición MÁS RECIENTE para este ticket
        const isWithdrawalReturn = log.metadata && typeof log.metadata === "object" && log.metadata.source === WITHDRAWAL_RETURN_AUDIT_SOURCE;
        result.set(log.ticketId, isWithdrawalReturn ? log.createdAt : null);
    }
    return result;
}

// now se recibe explícito (nunca `new Date()` interno) para que
// getSaleStatusService calcule returnedAt/returnWindowExpiresAt con el
// MISMO instante que usó para decidir si el ticket entra o no en la
// respuesta — nunca dos relojes ligeramente distintos en la misma llamada.
export function isWithinWithdrawalReturnWindow(returnedAt, now) {
    if (!returnedAt) return false;
    return now.getTime() - new Date(returnedAt).getTime() < WITHDRAWAL_RETURN_VISIBILITY_HOURS * 60 * 60 * 1000;
}
