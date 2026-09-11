import { getAuth } from "@clerk/express";
import { EVENT_CATEGORIES } from "../utils/eventCategories.js";
import { EVENT_SERVICE_ERROR_MESSAGES } from "../conversation/errorMessages.js";
import { ErrorCatalog } from "../errors/ErrorCatalog.js";
import {
    createEventService,
    getMyEventsService,
    getMyEventByIdService,
    updateMyEventService,
    deleteMyEventService,
    getPublicEventsService,
    getPublicEventBySlugService,
    getQuickPassBySlugService,
    syncEventScheduleService,
    syncEventLinksService,
    listArchivedEventsService,
    restoreEventService,
    duplicateEventService,
} from "../services/event.service.js";

const PUBLISH_ERROR_MESSAGES = EVENT_SERVICE_ERROR_MESSAGES;

const CUSTOM_CATEGORY_REQUIRED_MESSAGE = EVENT_SERVICE_ERROR_MESSAGES.CUSTOM_CATEGORY_REQUIRED;

const INVALID_LATITUDE_MESSAGE = EVENT_SERVICE_ERROR_MESSAGES.INVALID_LATITUDE;
const INVALID_LONGITUDE_MESSAGE = EVENT_SERVICE_ERROR_MESSAGES.INVALID_LONGITUDE;

const VALID_STATUSES = new Set([
    "DRAFT",
    "SCHEDULED",
    "PUBLISHED",
    "CANCELLED",
    "FINISHED",
]);

export const getEventCategories = (req, res) => {
    res.status(200).json({ categories: EVENT_CATEGORIES });
};

export const getPublicEvents = async (req, res) => {
    try {
        const { category, search, sort, when, price, organizationSlug } = req.query;
        const events = await getPublicEventsService({ category, search, sort, when, price, organizationSlug });
        res.status(200).json({ events });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener los eventos" });
    }
};

export const getPublicEventBySlug = async (req, res) => {
    try {
        const event = await getPublicEventBySlugService(req.params.slug);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener el evento" });
    }
};

// Quick Pass V1 — GET /api/events/quick-pass/:slug. Siempre 200: la
// disponibilidad se comunica con `available` (true/false), nunca con un 404,
// porque "no disponible" (desactivado, o evento no público) no es un error
// de la request, es un estado válido de la pantalla pública (ver el informe
// de entrega). Nunca expone más que getQuickPassBySlugService.
export const getQuickPassBySlug = async (req, res) => {
    try {
        const result = await getQuickPassBySlugService(req.params.slug);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener Quick Pass" });
    }
};

export const createEvent = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await createEventService(userId, req.body);
        res.status(201).json({ event });
    } catch (error) {
        console.error(error);

        if (error.message === "NO_ORGANIZATION") {
            return res.status(409).json({
                message: "Necesitás una organización aprobada para crear eventos",
            });
        }
        if (error.message === "TITLE_REQUIRED") {
            return res.status(400).json({ message: "El nombre del evento es obligatorio" });
        }
        if (error.message === "CUSTOM_CATEGORY_REQUIRED") {
            return res.status(400).json({ message: CUSTOM_CATEGORY_REQUIRED_MESSAGE });
        }
        if (error.message === "INVALID_LATITUDE") {
            return res.status(400).json({ message: INVALID_LATITUDE_MESSAGE });
        }
        if (error.message === "INVALID_LONGITUDE") {
            return res.status(400).json({ message: INVALID_LONGITUDE_MESSAGE });
        }
        if (error.message === "QUICK_PASS_IMAGE_REQUIRED") {
            return res.status(400).json({ message: EVENT_SERVICE_ERROR_MESSAGES.QUICK_PASS_IMAGE_REQUIRED });
        }

        res.status(500).json({ message: "Error al crear el evento" });
    }
};

export const getMyEvents = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const events = await getMyEventsService(userId);
        res.status(200).json({ events });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener los eventos" });
    }
};

export const getMyEventById = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await getMyEventByIdService(userId, req.params.id);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener el evento" });
    }
};

export const updateMyEvent = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        if (req.body.status && !VALID_STATUSES.has(req.body.status)) {
            return res.status(400).json({ message: "Estado inválido" });
        }

        const event = await updateMyEventService(userId, req.params.id, req.body);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);

        if (error.message === "ORGANIZATION_NOT_APPROVED") {
            return res.status(403).json({
                message:
                    "Tu organización todavía no fue aprobada. Podés preparar el evento, pero no publicarlo hasta que un Developer la apruebe.",
            });
        }

        if (error.message === "EVENT_ARCHIVED") {
            return res.status(409).json({ message: ErrorCatalog.EVENT_ARCHIVED.userMessage });
        }

        // Premium — Fase 2B. Antes de este branch caía en el fallback
        // genérico PUBLISH_ERROR_MESSAGES (400) — el código real en
        // ErrorCatalog.js es 409 ("tope de plan alcanzado", misma familia
        // que EVENT_ARCHIVED de arriba).
        if (error.message === "PLAN_ACTIVE_EVENT_LIMIT_REACHED") {
            return res.status(409).json({ message: ErrorCatalog.PLAN_ACTIVE_EVENT_LIMIT_REACHED.userMessage });
        }

        if (error.message === "CUSTOM_CATEGORY_REQUIRED") {
            return res.status(400).json({ message: CUSTOM_CATEGORY_REQUIRED_MESSAGE });
        }
        if (error.message === "INVALID_LATITUDE") {
            return res.status(400).json({ message: INVALID_LATITUDE_MESSAGE });
        }
        if (error.message === "INVALID_LONGITUDE") {
            return res.status(400).json({ message: INVALID_LONGITUDE_MESSAGE });
        }

        if (PUBLISH_ERROR_MESSAGES[error.message]) {
            return res.status(400).json({ message: PUBLISH_ERROR_MESSAGES[error.message] });
        }

        res.status(500).json({ message: "Error al actualizar el evento" });
    }
};

export const saveEventSchedule = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await syncEventScheduleService(userId, req.params.id, req.body);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);

        if (error.message === "NO_FUNCTIONS") {
            return res.status(400).json({ message: "El evento necesita al menos una función" });
        }
        if (error.message === "NO_TICKET_TYPES") {
            return res
                .status(400)
                .json({ message: "El evento necesita al menos una entrada en el catálogo" });
        }
        if (error.message === "FUNCTION_MISSING_FIELDS") {
            return res
                .status(400)
                .json({ message: "Cada función necesita fecha y lugar" });
        }
        if (error.message === "TICKET_TYPE_MISSING_FIELDS") {
            return res.status(400).json({
                message: "Cada entrada del catálogo necesita nombre, precio y cantidad",
            });
        }
        if (error.message === "PLAN_MAX_TICKETS_PER_EVENT_EXCEEDED") {
            const base = ErrorCatalog.PLAN_MAX_TICKETS_PER_EVENT_EXCEEDED.userMessage;
            const message =
                typeof error.planTicketsLimit === "number"
                    ? `${base} Tu plan permite hasta ${error.planTicketsLimit} entradas por evento.`
                    : base;
            return res.status(409).json({ message });
        }
        // Ronda "sincronización incremental" — syncEventScheduleService ya
        // NO borra y recrea toda la agenda a ciegas (ver el comentario ahí
        // mismo): reemplaza al guard temporal SCHEDULE_HAS_SALES de la
        // ronda anterior, que bloqueaba CUALQUIER edición de un evento con
        // ventas. Estos 4 casos son mucho más específicos — sólo bloquean
        // la operación puntual que de verdad rompería el historial.
        if (error.message === "SCHEDULE_FUNCTION_HAS_SALES") {
            return res.status(409).json({
                message: "Esta función ya tiene entradas vendidas y no puede eliminarse. Podés cancelarla en vez de borrarla.",
            });
        }
        if (error.message === "TICKET_TYPE_HAS_SALES") {
            return res.status(409).json({
                message: "Este tipo de entrada ya tiene ventas y no puede eliminarse. Podés ocultarlo del catálogo en vez de borrarlo.",
            });
        }
        if (error.message === "TICKET_STOCK_BELOW_COMMITTED") {
            const name = error.ticketTypeName ? `'${error.ticketTypeName}'` : "este tipo de entrada";
            const committedText = typeof error.committed === "number" ? ` (hay ${error.committed} entradas vendidas o reservadas)` : "";
            return res.status(409).json({
                message: `No podés bajar el stock de ${name} por debajo de lo ya vendido o reservado${committedText}.`,
            });
        }
        if (error.message === "SCHEDULE_FUNCTION_NOT_FOUND") {
            return res.status(404).json({ message: "Una de las funciones enviadas no existe en este evento." });
        }
        if (error.message === "TICKET_TYPE_NOT_FOUND") {
            return res.status(404).json({ message: "Uno de los tipos de entrada enviados no existe en este evento." });
        }
        if (EVENT_SERVICE_ERROR_MESSAGES[error.message]) {
            return res.status(400).json({ message: EVENT_SERVICE_ERROR_MESSAGES[error.message] });
        }
        // Fallback genérico para cualquier AppError (ej. EVENT_FINISHED,
        // lanzado por assertFunctionActive al intentar reprogramar una
        // función ya finalizada) — a diferencia de los códigos de arriba
        // (Error plano, convención legacy de este archivo), un AppError ya
        // trae su propio httpStatus/userMessage listos para usar, nunca
        // hace falta mapearlo a mano acá.
        if (error.httpStatus && error.userMessage) {
            return res.status(error.httpStatus).json({ message: error.userMessage });
        }

        res.status(500).json({ message: "Error al guardar la programación del evento" });
    }
};

export const saveEventLinks = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await syncEventLinksService(userId, req.params.id, req.body.links);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);

        if (error.message === "LINK_MISSING_FIELDS") {
            return res
                .status(400)
                .json({ message: "Cada enlace necesita un tipo y una URL" });
        }
        if (error.message === "LINK_INVALID_URL") {
            return res.status(400).json({ message: "Una de las URLs cargadas no es válida" });
        }
        if (error.message === "LINK_INVALID_VIDEO") {
            return res.status(400).json({
                message: "Ese enlace de YouTube no tiene un video válido. Revisá la URL.",
            });
        }
        if (error.message === "LINK_DUPLICATE_URL") {
            return res
                .status(400)
                .json({ message: "No podés cargar la misma URL dos veces en el mismo evento" });
        }

        res.status(500).json({ message: "Error al guardar los enlaces del evento" });
    }
};

export const deleteMyEvent = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const deleted = await deleteMyEventService(userId, req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(204).send();
    } catch (error) {
        console.error(error);

        if (error.message === "EVENT_HAS_DEPENDENCIES") {
            return res.status(409).json({
                message:
                    "Este evento no puede eliminarse porque tiene información asociada (ventas o entradas). Cancelalo en vez de eliminarlo.",
            });
        }

        res.status(500).json({ message: "Error al eliminar el evento" });
    }
};

// Historial de Eventos — sólo lectura/búsqueda + 2 acciones (restaurar,
// duplicar). Nunca edición directa (updateMyEvent ya rechaza eventos
// archivados con EVENT_ARCHIVED, ver arriba).
export const listArchivedEvents = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const events = await listArchivedEventsService(userId, { search: req.query.search });
        res.status(200).json({ events });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener el historial de eventos" });
    }
};

export const restoreEvent = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await restoreEventService(userId, req.params.id);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(200).json({ event });
    } catch (error) {
        console.error(error);

        // Premium — Fase 2B. Antes de este branch, cualquier error acá caía
        // en el 500 genérico de abajo (restoreEvent nunca tuvo mapeo propio).
        if (error.message === "PLAN_ACTIVE_EVENT_LIMIT_REACHED") {
            return res.status(409).json({ message: ErrorCatalog.PLAN_ACTIVE_EVENT_LIMIT_REACHED.userMessage });
        }

        res.status(500).json({ message: "Error al restaurar el evento" });
    }
};

export const duplicateEvent = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const event = await duplicateEventService(userId, req.params.id);
        if (!event) {
            return res.status(404).json({ message: "Evento no encontrado" });
        }

        res.status(201).json({ event });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al duplicar el evento" });
    }
};
