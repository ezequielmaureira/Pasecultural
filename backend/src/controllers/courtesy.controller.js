import { getAuth } from "@clerk/express";
import { AppError } from "../errors/AppError.js";
import {
    issueCourtesyService,
    listCourtesiesService,
    getCourtesyStatsService,
    getCourtesyPdfService,
    cancelCourtesyService,
} from "../services/courtesy.service.js";
import { resendSaleConfirmationEmailService } from "../services/email/sendSaleConfirmationEmail.service.js";

// Sólo validan req, llaman al service y devuelven la respuesta — toda la
// validación de negocio vive en courtesy.service.js (o en los services que
// reutiliza), igual que el resto de los controllers de la app.

export const issueCourtesy = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await issueCourtesyService(userId, req.body);
        res.status(201).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const listCourtesies = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { eventId, functionId, reason, status, dateFrom, dateTo } = req.query;
        const courtesies = await listCourtesiesService(userId, { eventId, functionId, reason, status, dateFrom, dateTo });
        res.status(200).json({ courtesies });
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getCourtesyStats = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const stats = await getCourtesyStatsService(userId, req.query.eventId);
        res.status(200).json({ stats });
    } catch (error) {
        next(AppError.from(error));
    }
};

// Reenviar por correo — reutiliza tal cual el mismo service que ya usa el
// Historial de Ventas (resendSaleConfirmationEmailService, ya autoriza
// DEVELOPER/organizador dueño y ya usa force:true) — no existe un wrapper
// propio de Cortesías para esto.
export const resendCourtesyEmail = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await resendSaleConfirmationEmailService(userId, req.params.saleId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const getCourtesyPdf = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const { pdfBuffer, fileName } = await getCourtesyPdfService(userId, req.params.saleId);
        res.status(200);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const cancelCourtesy = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await cancelCourtesyService(userId, req.params.saleId);
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
