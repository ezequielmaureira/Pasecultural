import { AppError } from "../errors/AppError.js";
import { getDeveloperAlertConfigService, replaceDeveloperAlertConfigService } from "../services/developerAlertConfig.service.js";

// GET /api/developer/alert-config — exclusivo DEVELOPER (ver
// developerAlertConfig.routes.js). Sólo lectura.
export const getDeveloperAlertConfig = async (req, res, next) => {
    try {
        const config = await getDeveloperAlertConfigService();
        res.status(200).json(config);
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/alert-config — reemplaza los umbrales de forma
// atómica. req.dbUser ya viene resuelto por requireRole (ver
// middlewares/requireRole.js) — nunca se vuelve a resolver acá.
export const updateDeveloperAlertConfig = async (req, res, next) => {
    try {
        const config = await replaceDeveloperAlertConfigService(req.dbUser.id, req.body);
        res.status(200).json(config);
    } catch (error) {
        next(AppError.from(error));
    }
};
