import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    cancelTicketService,
    rehabilitateTicketService,
    reactivateUsedTicketService,
    markTicketUsedManuallyService,
    softDeleteTicketService,
} from "../services/ticketAdmin.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta. Toda la
// validación de negocio (transición permitida, pertenencia del evento)
// vive en ticketAdmin.service.js — mismo patrón que eventScanner.controller.js.

export const cancelTicket = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await cancelTicketService(userId, req.params.id, req.params.ticketId, req.body ?? {});
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const rehabilitateTicket = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await rehabilitateTicketService(userId, req.params.id, req.params.ticketId, req.body ?? {});
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const reactivateUsedTicket = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await reactivateUsedTicketService(userId, req.params.id, req.params.ticketId, req.body ?? {});
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const markTicketUsedManually = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await markTicketUsedManuallyService(userId, req.params.id, req.params.ticketId, req.body ?? {});
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const softDeleteTicket = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        await softDeleteTicketService(userId, req.params.id, req.params.ticketId, req.body ?? {});
        res.status(204).send();
    } catch (error) {
        next(AppError.from(error));
    }
};
