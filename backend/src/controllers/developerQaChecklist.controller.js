import { AppError } from "../errors/AppError.js";
import { getQaChecklistOverviewService, updateQaChecklistItemService } from "../services/qaChecklist.service.js";

// GET /api/developer/qa-checklist — exclusivo DEVELOPER (ver
// developerQaChecklist.routes.js). Devuelve { items, stats }.
export const getQaChecklist = async (req, res, next) => {
    try {
        const overview = await getQaChecklistOverviewService();
        res.status(200).json(overview);
    } catch (error) {
        next(AppError.from(error));
    }
};

// PATCH /api/developer/qa-checklist/:key — body parcial:
// { checked?: true|false, note?: string|null }, al menos uno de los dos.
// req.dbUser ya viene resuelto por requireRole (ver middlewares/requireRole.js)
// — nunca se vuelve a resolver acá.
export const updateQaChecklistItem = async (req, res, next) => {
    try {
        const item = await updateQaChecklistItemService(
            req.params.key,
            { checked: req.body?.checked, note: req.body?.note },
            req.dbUser.id
        );
        res.status(200).json({ item });
    } catch (error) {
        next(AppError.from(error));
    }
};
