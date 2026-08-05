import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    listMyTicketsService,
    getTicketService,
    getQrPayloadService,
    getTicketByNumberService,
    listTicketsOrganizerService,
} from "../services/ticket.service.js";

export const listMyTickets = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const tickets = await listMyTicketsService(userId);
        res.status(200).json({ tickets });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getTicket = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await getTicketService(userId, req.params.id);
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getTicketQr = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const qr = await getQrPayloadService(userId, req.params.id);
        res.status(200).json({ qr });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getTicketByNumber = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const ticket = await getTicketByNumberService(userId, req.params.ticketNumber);
        res.status(200).json({ ticket });
    } catch (error) {
        next(AppError.from(error));
    }
};

// Panel de organizador "Entradas" — todos los tickets vendidos de todos sus
// eventos, con búsqueda y filtro de estado (ver listTicketsOrganizerService).
export const listTicketsOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { search, status } = req.query;
        const tickets = await listTicketsOrganizerService(userId, { search, status });
        res.status(200).json({ tickets });
    } catch (error) {
        next(AppError.from(error));
    }
};
