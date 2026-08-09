import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { generateUniqueSlug } from "../utils/generateSlug.js";
import { sendWhatsappTextMessage } from "./whatsapp.service.js";

// Herramienta exclusiva del panel Developer ("Base de Datos"). Protección
// simplificada TEMPORALMENTE: la única condición es requireRole("DEVELOPER")
// en devTools.routes.js — todavía no hay producción con clientes reales.
// Antes había una segunda capa acá (assertNonProduction) que repetía el
// chequeo de entorno por si algo llamaba a estas funciones sin pasar por la
// ruta; se saca a propósito junto con la de la ruta. Hay que reincorporar
// una capa extra cuando el proyecto tenga clientes reales.

// Mismas opciones que sale.service.js#confirmSaleService (maxWait/timeout
// explícitos en vez del default de Prisma), con el timeout más alto porque
// acá se puede estar borrando bastante más volumen que una venta puntual.
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 30000 };

export const getDevDatabaseStatsService = async () => {
    const [events, sales, tickets, scanners, checkIns] = await Promise.all([
        prisma.event.count(),
        prisma.sale.count(),
        prisma.ticket.count(),
        prisma.eventScanner.count(),
        prisma.checkIn.count(),
    ]);

    return { events, sales, tickets, scanners, checkIns };
};

// La UI pide doble confirmación (dos ConfirmDialog encadenados) — esto es
// la segunda capa del lado servidor: sin la frase exacta, ni con sesión de
// DEVELOPER se ejecuta nada.
const RESET_CONFIRMATION_PHRASE = "REINICIAR";

// Elimina TODAS las entidades transaccionales, en una única transacción y
// en el único orden que respeta cada FK real (ver auditoría — RESTRICT
// hacia Ticket/Sale/EventFunction/TicketType, CASCADE hacia Event). No usa
// ON DELETE CASCADE de la base ni confía en que el cascade ya declarado en
// el schema (EventFunction/TicketType/EventLink/EventScanner → Event) haga
// el trabajo solo: cada tabla se vacía explícitamente para que el resultado
// quede contado y sea auditable. Nunca toca User ni Organization.
export const resetDevDatabaseService = async ({ confirm } = {}) => {
    if (confirm !== RESET_CONFIRMATION_PHRASE) {
        throw new AppError(ErrorCodes.DEV_TOOLS_CONFIRMATION_REQUIRED);
    }

    const counts = await prisma.$transaction(async (tx) => {
        const result = {};
        result.ticketAuditLogs = (await tx.ticketAuditLog.deleteMany()).count;
        result.scanAttempts = (await tx.scanAttempt.deleteMany()).count;
        result.checkIns = (await tx.checkIn.deleteMany()).count;
        result.ticketQrs = (await tx.ticketQr.deleteMany()).count;
        result.tickets = (await tx.ticket.deleteMany()).count;
        result.saleItems = (await tx.saleItem.deleteMany()).count;
        result.sales = (await tx.sale.deleteMany()).count;
        result.saleRecoveryVerifications = (await tx.saleRecoveryVerification.deleteMany()).count;
        result.eventScanners = (await tx.eventScanner.deleteMany()).count;
        result.functionTicketTypes = (await tx.functionTicketType.deleteMany()).count;
        result.eventFunctions = (await tx.eventFunction.deleteMany()).count;
        result.ticketTypes = (await tx.ticketType.deleteMany()).count;
        result.eventLinks = (await tx.eventLink.deleteMany()).count;
        result.conversationStates = (await tx.conversationState.deleteMany()).count;
        result.events = (await tx.event.deleteMany()).count;
        return result;
    }, TRANSACTION_OPTIONS);

    return counts;
};

// "Crear evento demo" — un Event DRAFT con una función y dos tipos de
// entrada, para poder probar el resto de la app apenas se reinicia la
// base. No reutiliza createEventService/syncEventScheduleService (ambos
// atados a "la organización del clerkId que llama" vía getMyOrganization)
// porque un DEVELOPER puede no tener una Organization propia — en cambio
// se cuelga de la primera Organization que exista (User/Organization nunca
// se borran con el reset, así que después de resetear la base sigue
// habiendo al menos la del propio desarrollador si ya se registró como
// organizador alguna vez). Si no hay ninguna, error claro en vez de
// inventar una Organization/User falsos.
export const createDemoEventService = async () => {
    const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) {
        throw new AppError(ErrorCodes.DEV_TOOLS_NO_ORGANIZATION);
    }

    const slug = await generateUniqueSlug("Evento Demo", async (candidate) => {
        const existing = await prisma.event.findUnique({ where: { slug: candidate } });
        return Boolean(existing);
    });

    const functionDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return prisma.$transaction(async (tx) => {
        const event = await tx.event.create({
            data: {
                title: "Evento Demo",
                slug,
                category: "OTRO",
                customCategory: "Demo",
                shortDescription: "Evento generado por la herramienta de desarrollo (Developer → Base de Datos).",
                status: "DRAFT",
                organizationId: organization.id,
                createdBy: organization.ownerId,
                venueName: "Lugar de prueba",
                formattedAddress: "Dirección de prueba 123",
                startDate: functionDate,
            },
        });

        const eventFunction = await tx.eventFunction.create({
            data: {
                eventId: event.id,
                date: functionDate,
                venue: "Lugar de prueba",
                status: "SCHEDULED",
            },
        });

        const [generalType, vipType] = await Promise.all([
            tx.ticketType.create({ data: { eventId: event.id, name: "General", price: 1000, quantity: 100 } }),
            tx.ticketType.create({ data: { eventId: event.id, name: "VIP", price: 2500, quantity: 20 } }),
        ]);

        await tx.functionTicketType.createMany({
            data: [
                { functionId: eventFunction.id, ticketTypeId: generalType.id },
                { functionId: eventFunction.id, ticketTypeId: vipType.id },
            ],
        });

        return event;
    }, TRANSACTION_OPTIONS);
};

// "Probar WhatsApp" — dispara UN mensaje de texto libre puntual vía
// sendWhatsappTextMessage (whatsapp.service.js), sin ninguna lógica propia
// de negocio: sólo valida el destinatario y traduce el resultado
// normalizado a un AppError si Meta lo rechazó. No acopla nada de
// EventCreationEngine/EventServicePort — ver contexto de Fase 2C.
export const testSendWhatsappService = async ({ to, text }) => {
    if (!to || typeof to !== "string" || !to.trim()) {
        throw new AppError(ErrorCodes.WHATSAPP_RECIPIENT_REQUIRED);
    }

    const result = await sendWhatsappTextMessage({
        to: to.trim(),
        text: typeof text === "string" && text.trim() ? text.trim() : "Conexión PaseCultural OK",
    });

    if (!result.success) {
        throw new AppError(ErrorCodes.WHATSAPP_SEND_FAILED, { details: { metaError: result.error } });
    }

    return { messageId: result.messageId };
};
