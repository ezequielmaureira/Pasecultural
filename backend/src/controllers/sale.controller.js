import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    createSaleService,
    confirmSaleService,
    cancelSaleService,
    listSalesOrganizerService,
    listSalesBuyerService,
} from "../services/sale.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta. Toda la
// validación de negocio vive en sale.service.js — acá no hay ningún if de
// reglas de dominio.

export const createSale = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const sale = await createSaleService(userId, req.body);
        res.status(201).json({ sale });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const confirmSale = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await confirmSaleService(userId, req.params.id);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const cancelSale = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const sale = await cancelSaleService(userId, req.params.id);
        res.status(200).json({ sale });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listSalesOrganizer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { status, eventId, dateFrom, dateTo, buyer } = req.query;
        const sales = await listSalesOrganizerService(userId, { status, eventId, dateFrom, dateTo, buyer });
        res.status(200).json({ sales });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listSalesBuyer = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const sales = await listSalesBuyerService(userId);
        res.status(200).json({ sales });
    } catch (error) {
        next(AppError.from(error));
    }
};
