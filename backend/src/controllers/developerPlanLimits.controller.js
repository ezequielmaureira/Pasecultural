import { AppError } from "../errors/AppError.js";
import { getAllPlanLimitsForDeveloperService, updatePlanLimitsService } from "../services/organizationPlanPolicy.js";

// GET /api/developer/plan-limits — exclusivo DEVELOPER (ver
// developerPlanLimits.routes.js). Sólo lectura, devuelve { FREE: {...},
// PREMIUM: {...} }.
export const getDeveloperPlanLimits = async (req, res, next) => {
    try {
        const limits = await getAllPlanLimitsForDeveloperService();
        res.status(200).json(limits);
    } catch (error) {
        next(AppError.from(error));
    }
};

// PATCH /api/developer/plan-limits/:plan — reemplaza (parcialmente) los
// límites de UN plan. req.dbUser ya viene resuelto por requireRole (ver
// middlewares/requireRole.js) — nunca se vuelve a resolver acá.
export const updateDeveloperPlanLimits = async (req, res, next) => {
    try {
        const limits = await updatePlanLimitsService(req.params.plan, req.dbUser.id, req.body);
        res.status(200).json(limits);
    } catch (error) {
        next(AppError.from(error));
    }
};
