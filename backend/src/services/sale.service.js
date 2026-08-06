import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { runArchiveSelfHeal } from "./eventArchive.service.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { buildTicketNumber } from "../utils/ticketNumber.js";
import { encryptSecret, decryptSecret } from "../config/qrEncryption.js";
import { effectiveCapacity } from "./functionCapacity.service.js";
import { logger } from "../logging/logger.js";
import { sendSaleConfirmationEmail, getSaleEmailData } from "./email/sendSaleConfirmationEmail.service.js";
import { buildTicketQrImages } from "./email/ticketQrImages.js";
import { buildTicketsPdfBuffer } from "./email/ticketsPdf.js";

const ACTIVE_TICKET_STATUSES = ["ACTIVE", "USED"];

const SALE_LIST_INCLUDE = {
    buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
    event: { select: { id: true, title: true, organizationId: true } },
    function: { select: { id: true, date: true, venue: true } },
    items: { include: { ticketType: { select: { id: true, name: true } } } },
};

async function getOrganizationByOwner(userId) {
    return prisma.organization.findFirst({ where: { ownerId: userId } });
}

// Cuánto stock queda disponible para un tipo de entrada en una función
// puntual: capacidad (override de la función, o quantity del catálogo) menos
// tickets ya emitidos (ACTIVE o USED, nunca CANCELLED/REFUNDED) para esa
// combinación exacta. Nunca se guarda en una columna que se decrementa — se
// calcula siempre al vuelo, lo que deja la puerta abierta a agregar reservas
// temporales a futuro (contar también ventas PENDING no vencidas) sin
// rediseñar Sale ni Ticket.
async function getSoldCount(client, ticketTypeId, functionId) {
    return client.ticket.count({
        where: {
            ticketTypeId,
            functionId,
            status: { in: ACTIVE_TICKET_STATUSES },
            deletedAt: null,
        },
    });
}

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

// El comprador NUNCA necesita autenticarse con Clerk para comprar — busca o
// crea un User por email, con clerkId null ("invitado"). Postgres permite
// múltiples NULL en una columna @unique, así que muchos invitados conviven
// sin chocar entre sí. Si esta persona ya tenía cuenta real (clerkId no
// nulo), se reutiliza esa cuenta tal cual — no se pisan sus datos.
async function getOrCreateGuestBuyer({ firstName, lastName, email }) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!firstName?.trim() || !lastName?.trim() || !normalizedEmail) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return existing;

    return prisma.user.create({
        data: { email: normalizedEmail, firstName: firstName.trim(), lastName: lastName.trim(), clerkId: null },
    });
}

// Núcleo compartido de creación de venta, ya con el comprador resuelto (con
// cuenta real o invitado — a esta altura da lo mismo). NO descuenta stock
// todavía — el chequeo de disponibilidad acá es best-effort (evita que el
// comprador arme una reserva imposible), pero el chequeo autoritativo y
// definitivo ocurre recién en confirmSale(), bajo lock, que es el único
// punto que realmente genera tickets.
async function createSaleForBuyer(buyer, input) {
    const event = await prisma.event.findUnique({ where: { id: input?.eventId } });
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    const eventFunction = await prisma.eventFunction.findUnique({ where: { id: input?.functionId } });
    if (!eventFunction || eventFunction.eventId !== event.id) {
        throw new AppError(ErrorCodes.FUNCTION_NOT_FOUND);
    }

    const itemsInput = Array.isArray(input?.items) ? input.items : [];
    if (itemsInput.length === 0) {
        throw new AppError(ErrorCodes.SALE_ITEMS_REQUIRED);
    }
    for (const item of itemsInput) {
        if (!item?.ticketTypeId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new AppError(ErrorCodes.INVALID_SALE_ITEM);
        }
    }

    // Preparación para la futura recuperación segura de entradas (ver
    // Sale.buyerDocument en schema.prisma) — obligatorio para toda venta
    // NUEVA de acá en adelante; las ventas viejas simplemente no lo tienen
    // y siguen funcionando igual (QR, PDF, recuperación por
    // publicRecoveryToken no dependen de este campo para nada).
    if (!input?.buyerDocument) {
        throw new AppError(ErrorCodes.GUEST_BUYER_DOCUMENT_REQUIRED);
    }
    const buyerDocument = normalizeBuyerDocument(input.buyerDocument);
    if (!isValidBuyerDocument(buyerDocument)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_DOCUMENT);
    }

    const ticketTypeIds = [...new Set(itemsInput.map((item) => item.ticketTypeId))];
    const assignments = await prisma.functionTicketType.findMany({
        where: { functionId: eventFunction.id, ticketTypeId: { in: ticketTypeIds } },
        include: { ticketType: true },
    });
    const assignmentByTicketTypeId = new Map(assignments.map((a) => [a.ticketTypeId, a]));

    const saleItemsData = [];
    for (const item of itemsInput) {
        const assignment = assignmentByTicketTypeId.get(item.ticketTypeId);
        if (!assignment || assignment.ticketType.eventId !== event.id) {
            throw new AppError(ErrorCodes.TICKET_TYPE_NOT_FOUND);
        }
        if (!assignment.enabled) {
            throw new AppError(ErrorCodes.TICKET_TYPE_NOT_AVAILABLE);
        }

        const capacity = effectiveCapacity(assignment);
        const sold = await getSoldCount(prisma, item.ticketTypeId, eventFunction.id);
        if (sold + item.quantity > capacity) {
            throw new AppError(ErrorCodes.INSUFFICIENT_STOCK, { details: { ticketTypeId: item.ticketTypeId } });
        }

        const unitPrice = round2(assignment.priceOverride ?? assignment.ticketType.price);
        const subtotal = round2(unitPrice * item.quantity);
        saleItemsData.push({ ticketTypeId: item.ticketTypeId, quantity: item.quantity, unitPrice, subtotal });
    }

    const total = round2(saleItemsData.reduce((sum, item) => sum + item.subtotal, 0));

    const sale = await prisma.sale.create({
        data: {
            status: "PENDING",
            buyerId: buyer.id,
            eventId: event.id,
            functionId: eventFunction.id,
            total,
            // Mismo generador que TicketQr.secretEncrypted usa para el secret
            // del QR (crypto.randomBytes, no Math.random ni un cuid): esto va
            // a viajar en la URL del comprador y funciona como bearer token
            // para confirm-by-buyer/status, tiene que ser impredecible.
            publicRecoveryToken: crypto.randomBytes(32).toString("base64url"),
            // Ya normalizado (sin puntos/espacios/guiones) — nunca se guarda
            // el valor crudo que escribió el comprador.
            buyerDocument,
            items: { create: saleItemsData },
        },
        include: SALE_LIST_INCLUDE,
    });

    logger.info("Sale created (PENDING)", { saleId: sale.id, eventId: event.id, buyerId: buyer.id });
    return sale;
}

const finalizeConfirmSale = (saleId, organizerUserId) => {
    logger.info("confirmSaleService completed", { saleId, organizerUserId });
    return { saleId, status: "CONFIRMED" };
};

// Camino autenticado (organizador/desarrollador operando en nombre de un
// usuario con cuenta real) — se mantiene por si algo interno lo necesita
// a futuro. El Wizard de compra público NUNCA pasa por acá.
export const createSaleService = async (clerkId, input) => {
    const buyer = await getUserByClerkId(clerkId);
    if (!buyer) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    return createSaleForBuyer(buyer, input);
};

// Camino invitado — el único que usa el Wizard de compra público. `buyerInfo`
// es { firstName, lastName, email }, nunca un token de Clerk.
export const createGuestSaleService = async (buyerInfo, input) => {
    // input.buyerDocument nunca se loguea crudo — sólo si vino presente.
    logger.info("createGuestSaleService entered", {
        buyerInfo,
        input: { ...input, buyerDocument: input?.buyerDocument ? "[present]" : undefined },
    });
    const buyer = await getOrCreateGuestBuyer(buyerInfo ?? {});
    const sale = await createSaleForBuyer(buyer, input);
    logger.info("createGuestSaleService completed", { saleId: sale.id, buyerId: buyer.id, organizationId: sale.organizationId, eventId: sale.eventId });
    return sale;
};

// Reconstruye la respuesta pública de una venta ya CONFIRMED (sale +
// tickets enriquecidos) desde cero, a partir de lo que ya persiste en la
// base — no de lo que se acaba de generar en memoria. Se usa tanto justo
// después de confirmar como cuando confirmSaleService encuentra una venta
// que YA estaba CONFIRMED (llamada repetida — ver más abajo): en ambos
// casos el resultado tiene que ser exactamente el mismo, así que es la
// misma función la que lo arma. El secret de cada QR se reconstruye al
// vuelo con decryptSecret (igual que getSaleStatusService) — nunca hay un
// qrToken guardado en texto plano del que depender.
async function buildConfirmedSaleResult(saleId) {
    const confirmedSale = await prisma.sale.findUnique({ where: { id: saleId }, include: SALE_LIST_INCLUDE });
    const tickets = await prisma.ticket.findMany({
        where: { saleId, deletedAt: null },
        select: {
            id: true,
            ticketNumber: true,
            status: true,
            ticketTypeId: true,
            ticketType: { select: { name: true } },
            qr: { select: { secretEncrypted: true } },
        },
        orderBy: { sequence: "asc" },
    });

    const enrichedTickets = tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        ticketTypeId: ticket.ticketTypeId,
        ticketTypeName: ticket.ticketType?.name ?? "",
        eventTitle: confirmedSale.event.title,
        functionDate: confirmedSale.function.date,
        venue: confirmedSale.function.venue,
        qrToken: `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`,
    }));

    // buyerEmail viaja aparte (no sólo dentro de `sale.buyer`): así el
    // frontend puede mostrar "te lo mandamos a este correo" sin tener que
    // saber de la forma completa de `sale` — y sin depender del estado
    // local de BuyerInfoStep, que no sobrevive a una recarga de página.
    return { sale: confirmedSale, tickets: enrichedTickets, buyerEmail: confirmedSale.buyer?.email ?? null };
}

// El corazón del flujo de pago manual (y, a futuro, del webhook de Mercado
// Pago — ver nota de compatibilidad en confirmedBy). Todo en UNA
// transacción: si cualquier paso falla, rollback completo, cero estados
// intermedios.
export const confirmSaleService = async (clerkId, saleId) => {
    logger.info("confirmSaleService entered", { clerkId, saleId });
    const organizerUser = await getUserByClerkId(clerkId);
    if (!organizerUser) {
        logger.info("confirmSaleService failed: organizer user not found", { clerkId });
        throw new AppError(ErrorCodes.USER_NOT_FOUND);
    }

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            items: { include: { ticketType: true } },
            event: { include: { organization: true } },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    if (sale.event.organization.ownerId !== organizerUser.id) {
        logger.info("confirmSaleService failed: organizer does not own event organization", {
            saleId,
            organizerUserId: organizerUser.id,
            organizationOwnerId: sale.event.organization.ownerId,
        });
        // No se distingue de "no existe": no hace falta confirmarle a un
        // organizador ajeno que esa venta sí existe en otra organización.
        throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    }

    // Idempotente para el caso de llamada repetida sobre una venta que YA
    // quedó CONFIRMED (reintentos del frontend, timeouts, polling, doble
    // solicitud, StrictMode, retries de red — ver
    // sendSaleConfirmationEmail.service.js): no se vuelve a crear ningún
    // ticket, sólo se reconstruye y devuelve el mismo resultado de éxito de
    // siempre. CANCELLED/EXPIRED siguen sin poder "confirmarse" — para esos
    // sigue tirando error más abajo, sin tocar ese comportamiento.
    if (sale.status === "CONFIRMED") {
        logger.info("confirmSaleService: sale already CONFIRMED, replaying result", { saleId });
        const replayed = await buildConfirmedSaleResult(sale.id);
        const emailOutcome = await sendSaleConfirmationEmail(sale.id);
        return { ...replayed, emailDeliveryStatus: emailOutcome.status ?? "PENDING" };
    }
    if (sale.status !== "PENDING") {
        logger.info("confirmSaleService failed: sale not pending", { saleId, status: sale.status });
        throw new AppError(ErrorCodes.SALE_NOT_PENDING);
    }

    const result = await prisma.$transaction(async (tx) => {
        // 1) Advisory lock por cada (ticketType, function) involucrado: serializa
        // únicamente las confirmaciones que compiten por el mismo stock, sin
        // bloquear confirmaciones de otros tipos de entrada. Se libera solo al
        // terminar la transacción (commit o rollback).
        const uniqueTicketTypeIds = [...new Set(sale.items.map((item) => item.ticketTypeId))];
        for (const ticketTypeId of uniqueTicketTypeIds) {
            // El cast ::text es necesario: Prisma no puede deserializar el
            // `void` que devuelve pg_advisory_xact_lock. OJO: envolver esto en
            // un CTE no referenciado ("WITH locked AS (SELECT ...) SELECT 1")
            // NO sirve — se verificó empíricamente que Postgres puede no
            // ejecutar ese CTE si su resultado no se usa en la query externa,
            // dejando el lock silenciosamente sin tomar. El cast directo sobre
            // la misma columna proyectada garantiza que la función se evalúa.
            await tx.$queryRawUnsafe(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked`,
                `${ticketTypeId}:${sale.functionId}`
            );
        }

        // 2) Update condicional atómico PENDING -> CONFIRMED: si dos requests
        // llegan a confirmar la misma venta al mismo tiempo, sólo uno encuentra
        // status: PENDING todavía y gana la carrera.
        const updated = await tx.sale.updateMany({
            where: { id: sale.id, status: "PENDING" },
            data: {
                status: "CONFIRMED",
                confirmedAt: new Date(),
                confirmedBy: organizerUser.id,
            },
        });
        if (updated.count === 0) {
            throw new AppError(ErrorCodes.SALE_ALREADY_PROCESSED);
        }

        // 3) Re-chequeo autoritativo de stock, ya bajo el advisory lock (el de
        // createSale era solo orientativo). Si otra venta se coló entre la
        // reserva y esta confirmación, se aborta y hace rollback completo
        // (incluye el update de status del paso 2).
        const assignments = await tx.functionTicketType.findMany({
            where: { functionId: sale.functionId, ticketTypeId: { in: uniqueTicketTypeIds } },
            include: { ticketType: { select: { quantity: true } } },
        });
        const assignmentByTicketTypeId = new Map(assignments.map((a) => [a.ticketTypeId, a]));

        for (const item of sale.items) {
            const assignment = assignmentByTicketTypeId.get(item.ticketTypeId);
            const capacity = assignment ? effectiveCapacity(assignment) : item.ticketType.quantity;
            const sold = await getSoldCount(tx, item.ticketTypeId, sale.functionId);
            if (sold + item.quantity > capacity) {
                throw new AppError(ErrorCodes.INSUFFICIENT_STOCK, { details: { ticketTypeId: item.ticketTypeId } });
            }
        }

        // 4) Generar Tickets + TicketQr, uno por unidad comprada — en batch
        // (createMany), no un create() por ticket. Con ventas grandes (ej. un
        // grupo de 40+ entradas), crear una por una en un loop secuencial
        // significa decenas de round-trips a la base dentro de la misma
        // transacción y termina superando el timeout de $transaction (5s por
        // default en Prisma) bajo la latencia real de un pooler — se
        // reprodujo en pruebas (P2028) antes de este cambio. `nextval()` se
        // pide una sola vez para TODAS las unidades de la venta
        // (generate_series), no una vez por ticket.
        const totalQuantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);
        const sequenceRows = await tx.$queryRawUnsafe(
            `SELECT nextval('tickets_sequence_seq') AS seq FROM generate_series(1, $1)`,
            totalQuantity
        );
        const sequences = sequenceRows.map((row) => Number(row.seq));

        const ticketRows = [];
        const qrRows = [];
        const tickets = [];
        let sequenceIndex = 0;

        for (const item of sale.items) {
            for (let i = 0; i < item.quantity; i += 1) {
                const sequence = sequences[sequenceIndex++];
                const ticketNumber = buildTicketNumber(sequence);
                const secret = crypto.randomBytes(24).toString("base64url");
                const ticketId = crypto.randomUUID();

                ticketRows.push({
                    id: ticketId,
                    sequence,
                    ticketNumber,
                    status: "ACTIVE",
                    saleId: sale.id,
                    eventId: sale.eventId,
                    functionId: sale.functionId,
                    ticketTypeId: item.ticketTypeId,
                    buyerId: sale.buyerId,
                    ownerId: sale.buyerId, // hoy siempre igual al buyer; separado para permitir transferencias a futuro
                });
                qrRows.push({
                    id: crypto.randomUUID(),
                    ticketId,
                    secretEncrypted: encryptSecret(secret),
                });

                // El secret en claro solo existe acá, en memoria, para devolverlo
                // una vez en la respuesta de esta operación. Nunca se persiste.
                tickets.push({ id: ticketId, ticketNumber, status: "ACTIVE", ticketTypeId: item.ticketTypeId, qrToken: `${ticketId}.${secret}` });
            }
        }

        await tx.ticket.createMany({ data: ticketRows });
        await tx.ticketQr.createMany({ data: qrRows });

        return { saleId: sale.id, tickets };
    });

    logger.info("Sale confirmed", {
        saleId: sale.id,
        confirmedBy: organizerUser.id,
        ticketCount: result.tickets.length,
    });

    // Se reconstruye con la misma función que usa el camino "ya estaba
    // CONFIRMED" en vez de armar la respuesta a mano acá con lo que
    // devolvió la transacción — así los dos caminos siempre devuelven
    // exactamente la misma forma, sin dos versiones de esta lógica para
    // mantener sincronizadas.
    const confirmedResult = await buildConfirmedSaleResult(sale.id);

    // Nunca dentro de la transacción de arriba (ya cerrada): Resend es una
    // llamada de red a un servicio externo, no puede formar parte de un
    // rollback de Postgres. Si el email falla, sendSaleConfirmationEmail lo
    // deja registrado como FAILED y devuelve sin lanzar — la compra ya
    // confirmada nunca se revierte ni se le muestra como fallida al
    // comprador por esto.
    const emailOutcome = await sendSaleConfirmationEmail(sale.id);

    return { ...confirmedResult, emailDeliveryStatus: emailOutcome.status ?? "PENDING" };
};

// Solo se puede cancelar una venta PENDING — nunca una ya confirmada (eso
// requeriría reembolso, fuera de alcance de esta fase). Permitido tanto al
// comprador (se arrepiente) como al organizador (rechaza la reserva).
export const cancelSaleService = async (clerkId, saleId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: { event: { include: { organization: true } } },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const isBuyer = sale.buyerId === user.id;
    const isOrganizer = sale.event.organization.ownerId === user.id;
    if (!isBuyer && !isOrganizer) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const updated = await prisma.sale.updateMany({
        where: { id: saleId, status: "PENDING" },
        data: { status: "CANCELLED" },
    });
    if (updated.count === 0) throw new AppError(ErrorCodes.SALE_NOT_PENDING);

    logger.info("Sale cancelled", { saleId, cancelledBy: user.id });
    return prisma.sale.findUnique({ where: { id: saleId }, include: SALE_LIST_INCLUDE });
};

// Si se pide un `eventId` puntual, siempre se devuelve (aunque esté
// archivado — ej. el detalle del Historial de Eventos necesita poder leer
// sus ventas finales). El filtro `archivedAt: null` sólo aplica al listado
// "todos mis eventos" (pantalla operativa de Ventas): ese es el que nunca
// debe mostrar ventas de un evento que ya pasó al Historial.
export const listSalesOrganizerService = async (clerkId, filters = {}) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    const organization = await getOrganizationByOwner(user.id);
    if (!organization) return [];

    if (!filters.eventId) {
        await runArchiveSelfHeal(prisma, { organizationId: organization.id });
    }

    const where = {
        event: {
            organizationId: organization.id,
            ...(filters.eventId ? {} : { archivedAt: null }),
        },
        deletedAt: null,
    };

    if (filters.status) where.status = filters.status;
    if (filters.eventId) where.eventId = filters.eventId;

    if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    if (filters.buyer?.trim()) {
        const term = filters.buyer.trim();
        where.buyer = {
            OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
                { email: { contains: term, mode: "insensitive" } },
            ],
        };
    }

    return prisma.sale.findMany({ where, include: SALE_LIST_INCLUDE, orderBy: { createdAt: "desc" } });
};

export const listSalesBuyerService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    return prisma.sale.findMany({
        where: { buyerId: user.id, deletedAt: null },
        include: SALE_LIST_INCLUDE,
        orderBy: { createdAt: "desc" },
    });
};

// Recuperación por timeout del Wizard invitado (usePublishFlow) Y también
// consulta usada para reconstruir la pantalla de éxito cuando el estado de
// React no sobrevivió (recarga de página, o el día de mañana un redirect
// real de Mercado Pago). Sin sesión no hay forma de listar "mis ventas" —
// por eso este endpoint se resuelve por publicRecoveryToken (nunca por el
// `id` interno: ese es la clave primaria, no un secreto — aparece en URLs
// de organizador, en logs, en relaciones; el token es aleatorio y no sirve
// para nada más que esto). Mientras la venta no esté CONFIRMED no devuelve
// nada del detalle de la compra (nunca nombre, email, ni tickets); recién
// confirmada trae exactamente lo mismo que ya devuelve confirmSaleService
// en su respuesta original, para que la pantalla de éxito pueda
// renderizarse igual sin importar por qué camino llegó el dato. El secret
// de cada QR se reconstruye acá al vuelo (decryptSecret) — nunca se
// persiste en texto plano, así que no hay nada "cacheado" que filtrar.
export const getSaleStatusService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: {
            id: true,
            status: true,
            deletedAt: true,
            confirmationEmailStatus: true,
            buyer: { select: { email: true } },
            event: { select: { title: true } },
            function: { select: { date: true, venue: true } },
            tickets: {
                where: { deletedAt: null },
                select: {
                    id: true,
                    ticketNumber: true,
                    status: true,
                    ticketTypeId: true,
                    ticketType: { select: { name: true } },
                    qr: { select: { secretEncrypted: true } },
                },
            },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    if (sale.status !== "CONFIRMED") {
        return { id: sale.id, status: sale.status };
    }

    const tickets = sale.tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        ticketTypeId: ticket.ticketTypeId,
        ticketTypeName: ticket.ticketType?.name ?? "",
        eventTitle: sale.event.title,
        functionDate: sale.function.date,
        venue: sale.function.venue,
        qrToken: `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`,
    }));

    return {
        id: sale.id,
        status: sale.status,
        tickets,
        buyerEmail: sale.buyer?.email ?? null,
        emailDeliveryStatus: sale.confirmationEmailStatus,
    };
};

// Query real de "Recuperar mis entradas", separada de recoverSalesService
// para que saleRecoveryVerification.service.js pueda reusarla con valores ya
// normalizados (antes de mandar el código, y de nuevo recién después de
// verificarlo) sin duplicar el where/select ni revalidar formato dos veces.
async function findConfirmedRecoverableSales(normalizedEmail, normalizedDocument) {
    const sales = await prisma.sale.findMany({
        where: {
            status: "CONFIRMED",
            deletedAt: null,
            buyerDocument: normalizedDocument,
            buyer: { email: normalizedEmail },
            // Ventas de antes de que existiera publicRecoveryToken no se
            // pueden "abrir" después (no hay token al que mandarlas) — se
            // excluyen acá en vez de devolver un resultado roto. No es una
            // regresión: esas ventas ya entregaron sus entradas en su
            // momento, y esta pantalla es una funcionalidad nueva.
            publicRecoveryToken: { not: null },
        },
        select: {
            publicRecoveryToken: true,
            createdAt: true,
            buyer: { select: { firstName: true } },
            event: { select: { title: true } },
            function: { select: { date: true, venue: true } },
            tickets: { where: { deletedAt: null }, select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    return sales
        .filter((sale) => sale.tickets.length > 0)
        .map((sale) => ({
            recoveryToken: sale.publicRecoveryToken,
            eventTitle: sale.event.title,
            functionDate: sale.function.date,
            venue: sale.function.venue,
            ticketCount: sale.tickets.length,
            buyerFirstName: sale.buyer?.firstName ?? "",
        }));
}

export { findConfirmedRecoverableSales };

// Búsqueda interna de "Recuperar mis entradas" — email + DNI sólo
// LOCALIZAN una compra propia, nunca autorizan verla: nunca se llama desde
// un controller directamente. saleRecoveryVerification.service.js es el
// único punto que decide qué hacer con este resultado (mandar un código de
// 6 dígitos si hay match, y recién devolver estos datos al comprador después
// de que ese código se verifique) — ver requestSaleRecoveryCodeService /
// verifySaleRecoveryCodeService. A diferencia de publicRecoveryToken (un
// secreto de alta entropía que sólo conoce quien compró), acá la prueba de
// posesión es "conocer dos datos personales exactos a la vez", así que el
// resultado nunca distingue si falló el email, el DNI, o ambos: siempre la
// misma lista (vacía o no), nunca un error que revele cuál de los dos
// estuvo mal.
export const recoverSalesService = async ({ email, buyerDocument }) => {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !buyerDocument?.trim()) {
        throw new AppError(ErrorCodes.RECOVER_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);
    }
    const normalizedDocument = normalizeBuyerDocument(buyerDocument);
    if (!isValidBuyerDocument(normalizedDocument)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_DOCUMENT);
    }

    const sales = await findConfirmedRecoverableSales(normalizedEmail, normalizedDocument);

    // Nunca se loguea email/DNI (son justo el dato sensible de esta
    // búsqueda) — sólo cuántos resultados dio.
    logger.info("recoverSalesService completed", { matchCount: sales.length });

    return sales;
};

// Botón "Reenviar correo" de la pantalla de recuperación — mismo modelo de
// autorización que confirm-by-buyer/status (conocer el publicRecoveryToken
// alcanza, sin sesión). Reutiliza sendSaleConfirmationEmail tal cual: hereda
// gratis el reclamo atómico (nunca dos envíos en paralelo, nunca reenvía si
// ya está SENT) y nunca genera tickets nuevos ni toca la venta — sólo
// intenta el envío.
export const resendConfirmationEmailByTokenService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: { id: true, status: true, deletedAt: true },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    if (sale.status !== "CONFIRMED") throw new AppError(ErrorCodes.SALE_NOT_CONFIRMED);

    const result = await sendSaleConfirmationEmail(sale.id);
    return { emailDeliveryStatus: result.status ?? "PENDING" };
};

// Botón "Descargar PDF" de la pantalla "Compra encontrada" — mismo modelo
// de autorización que resendConfirmationEmailByTokenService (conocer el
// publicRecoveryToken alcanza, sin sesión). Arma EXACTAMENTE el mismo PDF
// que ya se adjunta al email de confirmación: reusa getSaleEmailData (junta
// tickets + desencripta los secrets de QR), buildTicketQrImages y
// buildTicketsPdfBuffer tal cual — nunca genera tickets ni QR nuevos, sólo
// vuelve a renderizar el mismo PDF a partir de los datos ya existentes.
export const getSalePdfByTokenService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: { id: true, status: true, deletedAt: true },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    if (sale.status !== "CONFIRMED") throw new AppError(ErrorCodes.SALE_NOT_CONFIRMED);

    const data = await getSaleEmailData(sale.id);
    if (!data || data.tickets.length === 0) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const qrImages = await buildTicketQrImages(data.tickets);
    const pdfBuffer = await buildTicketsPdfBuffer({
        eventTitle: data.eventTitle,
        venue: data.venue,
        functionDate: data.functionDate,
        tickets: data.tickets,
        qrImages,
    });

    return { pdfBuffer, fileName: `entradas-pasecultural-${data.saleId}.pdf` };
};
