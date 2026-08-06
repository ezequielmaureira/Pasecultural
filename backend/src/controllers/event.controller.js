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
        const { category, search, sort, when, price } = req.query;
        const events = await getPublicEventsService({ category, search, sort, when, price });
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
