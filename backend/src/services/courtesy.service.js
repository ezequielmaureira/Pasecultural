import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { getEmailConfig } from "../config/resend.js";
import { createSaleForBuyer, confirmSaleService } from "./sale.service.js";
import { bulkApplyTicketActionService } from "./ticketAdmin.service.js";
import { getSaleEmailData } from "./email/sendSaleConfirmationEmail.service.js";
import { buildTicketQrImages } from "./email/ticketQrImages.js";
import { buildTicketsPdfBuffer } from "./email/ticketsPdf.js";

// Una cortesía es una Sale/Ticket normal (origin=COURTESY) — este archivo
// NUNCA genera tickets/QR por su cuenta: siempre delega en
// createSaleForBuyer + confirmSaleService (sale.service.js), el mismo
// núcleo que usa cualquier venta real. Lo único propio de acá es resolver
// quién puede emitir, quién es el "comprador" cuando no hay ningún dato de
// contacto, y la fila de auditoría (CourtesyIssuance).

const DELIVERY_METHODS = new Set(["SHARE", "EMAIL"]);
const REASONS = new Set(["SPONSOR", "PRENSA", "INVITADO", "STAFF", "ARTISTA", "FAMILIAR", "PROTOCOLO", "OTRO"]);

// Mismo criterio de autorización que ya usa resendSaleConfirmationEmailService
// (email/sendSaleConfirmationEmail.service.js): DEVELOPER puede operar sobre
// cualquier organización, ORGANIZER sólo sobre la propia. No se reutiliza
// getOwnedEvent (eventScanner.service.js) a propósito — esa función es
// estrictamente "el organizador dueño de este evento", sin bypass para
// DEVELOPER, y está reusada por Scanners/Entradas/Estado de Funciones tal
// cual; ampliarla ahí afectaría esos módulos sin que nadie lo haya pedido.
async function resolveEventForCourtesy(clerkId, eventId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organization: true } });
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const isDeveloper = user.role === "DEVELOPER";
    const isOwningOrganizer = user.role === "ORGANIZER" && event.organization.ownerId === user.id;
    if (!isDeveloper && !isOwningOrganizer) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);
    if (event.archivedAt) throw new AppError(ErrorCodes.EVENT_ARCHIVED);

    return { user, event };
}

// Mismo shape de acceso que resolveEventForCourtesy, pero partiendo de una
// Sale ya existente (acciones del Historial: PDF, cancelar). `origin` se
// revalida acá — este módulo nunca debe poder operar sobre una venta real
// por id adivinado.
async function resolveOwnedCourtesySale(clerkId, saleId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: { event: { include: { organization: true } } },
    });
    if (!sale || sale.deletedAt || sale.origin !== "COURTESY") throw new AppError(ErrorCodes.COURTESY_NOT_FOUND);

    const isDeveloper = user.role === "DEVELOPER";
    const isOwningOrganizer = user.role === "ORGANIZER" && sale.event.organization.ownerId === user.id;
    if (!isDeveloper && !isOwningOrganizer) throw new AppError(ErrorCodes.COURTESY_NOT_FOUND);

    return { user, sale };
}

// Mismo criterio que getOrCreateGuestBuyer (sale.service.js) para
// encontrar-o-crear un User por email — pero SIN exigir nombre/apellido:
// el asistente de Cortesías nunca le pide esos datos a nadie (pedido
// explícito). No se reutiliza getOrCreateGuestBuyer tal cual porque esa
// función haría fallar la emisión exigiendo un nombre que acá no existe.
async function getOrCreateCourtesyRecipient(email) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) throw new AppError(ErrorCodes.COURTESY_RECIPIENT_EMAIL_REQUIRED);
    if (!isValidEmail(normalizedEmail)) throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return existing;

    return prisma.user.create({
        data: { email: normalizedEmail, firstName: "Cortesía", lastName: "", clerkId: null },
    });
}

// Estado mostrado en el Historial — SIEMPRE derivado en la lectura, nunca
// guardado (mismo criterio que el stock: una columna que se pueda
// desincronizar es peor que recalcular). Cancelada/Utilizada salen de
// Ticket.status (la misma fuente de verdad que ya usa todo el resto de la
// app — Scanner, Estado de Funciones); Entregada/Pendiente de
// confirmationEmailStatus para EMAIL, o directo Entregada para Compartir
// (el link ya existe y se compartió como parte del mismo flujo de emisión).
function deriveCourtesyStatus(sale) {
    if (sale.status === "CANCELLED") return "CANCELLED";
    if (sale.status !== "CONFIRMED") return "PENDING";

    const ticketStatuses = sale.tickets.map((t) => t.status);
    if (ticketStatuses.length > 0 && ticketStatuses.every((s) => s === "CANCELLED")) return "CANCELLED";
    if (ticketStatuses.some((s) => s === "USED")) return "USED";
    if (sale.courtesy?.deliveryMethod === "EMAIL" && sale.confirmationEmailStatus !== "SENT") return "PENDING";
    return "DELIVERED";
}

function buildShareUrl(sale) {
    const { frontendUrl } = getEmailConfig();
    return `${frontendUrl}/comprar?saleToken=${sale.publicRecoveryToken}`;
}

// Único punto de emisión. Reutiliza EXACTAMENTE el mismo pipeline que una
// venta real: createSaleForBuyer (con las dos validaciones que no aplican
// acá desactivadas, ver sale.service.js) + confirmSaleService — nunca se
// crea un Ticket/QR "a mano" en este archivo.
export const issueCourtesyService = async (clerkId, input) => {
    const { user: issuer, event } = await resolveEventForCourtesy(clerkId, input?.eventId);

    const deliveryMethod = input?.deliveryMethod;
    if (!DELIVERY_METHODS.has(deliveryMethod)) {
        throw new AppError(ErrorCodes.COURTESY_DELIVERY_METHOD_INVALID);
    }

    const reason = REASONS.has(input?.reason) ? input.reason : null;
    const reasonNote = input?.reasonNote?.trim() || null;
    const quantity = Number.isInteger(input?.quantity) && input.quantity > 0 ? input.quantity : 1;

    let recipientEmail = null;
    let buyer;
    if (deliveryMethod === "EMAIL") {
        buyer = await getOrCreateCourtesyRecipient(input?.recipientEmail);
        recipientEmail = buyer.email;
    } else {
        // "Compartir": no se pide ningún dato de contacto. El comprador
        // registrado en la Sale es quien la emite (Sale.buyerId no admite
        // null) — evita crear usuarios sintéticos sin ningún dato real.
        buyer = issuer;
    }

    const sale = await createSaleForBuyer(
        buyer,
        {
            eventId: event.id,
            functionId: input?.functionId,
            items: [{ ticketTypeId: input?.ticketTypeId, quantity }],
        },
        { requireBuyerDocument: false, enforceMaxPerPurchase: false, origin: "COURTESY" }
    );

    // "Compartir" nunca dispara el correo automático de confirmación — el
    // operador ni siquiera pidió un email. "Enviar por correo" sí, y es
    // EXACTAMENTE el mismo correo que recibe un comprador real.
    // courtesyQuota: true — Premium Fase 2B, único caller de todo el repo
    // que la pasa. Aplica maxCourtesiesPerEvent atómicamente dentro de la
    // MISMA transacción que crea los Tickets (ver sale.service.js); si
    // excede el límite, confirmSaleService lanza PLAN_COURTESY_LIMIT_REACHED
    // y la Sale queda PENDING sin generar ningún Ticket.
    const confirmed = await confirmSaleService(clerkId, sale.id, {
        skipAutoEmail: deliveryMethod === "SHARE",
        courtesyQuota: true,
    });

    await prisma.courtesyIssuance.create({
        data: {
            saleId: sale.id,
            reason,
            reasonNote,
            deliveryMethod,
            recipientEmail,
            issuedByUserId: issuer.id,
        },
    });

    logger.info("Courtesy issued", {
        saleId: sale.id,
        eventId: event.id,
        functionId: input?.functionId,
        ticketTypeId: input?.ticketTypeId,
        quantity,
        deliveryMethod,
        reason,
        issuedBy: issuer.id,
    });

    return { ...confirmed, shareUrl: buildShareUrl(sale) };
};

// Historial de cortesías — organizador ve sólo las de su organización,
// developer las ve todas (mismo criterio que resolveEventForCourtesy).
export const listCourtesiesService = async (clerkId, filters = {}) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    const isDeveloper = user.role === "DEVELOPER";

    const where = { origin: "COURTESY", deletedAt: null };
    if (!isDeveloper) where.event = { organization: { ownerId: user.id } };
    if (filters.eventId) where.eventId = filters.eventId;
    if (filters.functionId) where.functionId = filters.functionId;
    if (filters.reason && REASONS.has(filters.reason)) where.courtesy = { reason: filters.reason };
    if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    const sales = await prisma.sale.findMany({
        where,
        include: {
            event: { select: { id: true, title: true } },
            function: { select: { id: true, date: true, venue: true } },
            items: { include: { ticketType: { select: { id: true, name: true } } } },
            courtesy: { include: { issuedBy: { select: { firstName: true, lastName: true, email: true } } } },
            tickets: { select: { status: true }, where: { deletedAt: null } },
        },
        orderBy: { createdAt: "desc" },
    });

    // Filtro por estado derivado: no se puede hacer en el WHERE de Prisma
    // (no es una columna), así que se resuelve en memoria sobre el listado
    // ya acotado por organización/evento/fecha — el volumen de cortesías de
    // un evento nunca se acerca al de tickets/ventas totales.
    const rows = sales.map((sale) => ({
        saleId: sale.id,
        publicRecoveryToken: sale.publicRecoveryToken,
        createdAt: sale.createdAt,
        event: sale.event,
        function: sale.function,
        ticketType: sale.items[0]?.ticketType ?? null,
        quantity: sale.items[0]?.quantity ?? 0,
        // "si existe": sólo tiene sentido para EMAIL — Compartir nunca pide
        // ningún dato de contacto, así que nunca hay a quién nombrar acá.
        recipientEmail: sale.courtesy?.deliveryMethod === "EMAIL" ? sale.courtesy.recipientEmail : null,
        reason: sale.courtesy?.reason ?? null,
        reasonNote: sale.courtesy?.reasonNote ?? null,
        deliveryMethod: sale.courtesy?.deliveryMethod ?? null,
        issuedBy: sale.courtesy?.issuedBy
            ? [sale.courtesy.issuedBy.firstName, sale.courtesy.issuedBy.lastName].filter(Boolean).join(" ").trim() ||
              sale.courtesy.issuedBy.email
            : null,
        status: deriveCourtesyStatus(sale),
    }));

    return filters.status ? rows.filter((row) => row.status === filters.status) : rows;
};

// Estadísticas propias del módulo — nunca toca/recalcula getFunctionStats ni
// ningún contador de capacidad existente (functionCapacity.service.js): esos
// siguen contando TODOS los tickets emitidos, cortesía o no, exactamente
// como contaban antes de que este módulo existiera (una cortesía ocupa un
// lugar real). Esto es sólo el desglose propio de Cortesías.
export const getCourtesyStatsService = async (clerkId, eventId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    const isDeveloper = user.role === "DEVELOPER";

    const where = { origin: "COURTESY", deletedAt: null, eventId };
    if (!isDeveloper) where.event = { organization: { ownerId: user.id } };

    const sales = await prisma.sale.findMany({
        where,
        select: {
            status: true,
            confirmationEmailStatus: true,
            courtesy: { select: { deliveryMethod: true } },
            tickets: { select: { status: true }, where: { deletedAt: null } },
        },
    });

    let issued = 0;
    let used = 0;
    let pending = 0;
    let cancelled = 0;
    for (const sale of sales) {
        const ticketCount = sale.tickets.length;
        issued += ticketCount;
        const status = deriveCourtesyStatus(sale);
        if (status === "USED") used += ticketCount;
        else if (status === "CANCELLED") cancelled += ticketCount;
        else if (status === "PENDING") pending += ticketCount;
    }

    return { issued, used, pending, cancelled };
};

// "Descargar PDF" del Historial — mismo PDF que ya se adjunta al correo de
// confirmación (getSaleEmailData + buildTicketQrImages + buildTicketsPdfBuffer,
// idéntico a getSalePdfByTokenService en sale.service.js), sólo cambia cómo
// se autoriza: acá por sesión de organizador, no por publicRecoveryToken.
export const getCourtesyPdfService = async (clerkId, saleId) => {
    const { sale } = await resolveOwnedCourtesySale(clerkId, saleId);

    const data = await getSaleEmailData(sale.id);
    if (!data || data.tickets.length === 0) throw new AppError(ErrorCodes.COURTESY_NOT_FOUND);

    const qrImages = await buildTicketQrImages(data.tickets);
    const pdfBuffer = await buildTicketsPdfBuffer({
        eventTitle: data.eventTitle,
        venue: data.venue,
        functionDate: data.functionDate,
        tickets: data.tickets,
        qrImages,
    });

    // Mismo nombre de archivo que getSalePdfByTokenService (sale.service.js)
    // — una cortesía es una Sale como cualquier otra, el PDF no se distingue.
    return { pdfBuffer, fileName: `entradas-pasecultural-${data.saleId}.pdf` };
};

// "Cancelar" — nunca toca Ticket directamente: delega en
// bulkApplyTicketActionService (ticketAdmin.service.js), la misma función
// que ya usa la pantalla de Entradas, con su propio TicketAuditLog. Cancela
// TODOS los tickets ACTIVE de la cortesía (una emisión puede ser >1 unidad).
// Nota: bulkApplyTicketActionService se apoya en getOwnedEvent
// (eventScanner.service.js), que no tiene bypass para DEVELOPER — un
// desarrollador puede EMITIR/ver/descargar el PDF de una cortesía de
// cualquier organización (ver resolveEventForCourtesy/resolveOwnedCourtesySale
// arriba), pero cancelar la de una organización ajena hereda esa misma
// limitación que ya existe hoy en todo ticketAdmin.service.js — ampliarla
// es una decisión de seguridad más amplia, fuera del alcance de este módulo.
export const cancelCourtesyService = async (clerkId, saleId) => {
    const { sale } = await resolveOwnedCourtesySale(clerkId, saleId);

    const tickets = await prisma.ticket.findMany({
        where: { saleId: sale.id, deletedAt: null },
        select: { id: true },
    });
    const ticketIds = tickets.map((t) => t.id);

    const cancelledIds = await bulkApplyTicketActionService(clerkId, sale.eventId, {
        ticketIds,
        action: "cancel",
        reason: "Cortesía cancelada desde el Historial de Cortesías",
    });

    logger.info("Courtesy cancelled", { saleId: sale.id, cancelledTicketIds: cancelledIds });
    return { saleId: sale.id, cancelledTicketIds: cancelledIds };
};
