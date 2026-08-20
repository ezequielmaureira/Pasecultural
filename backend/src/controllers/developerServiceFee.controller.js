import { AppError } from "../errors/AppError.js";
import { getServiceFeeConfigService, updateServiceFeeConfigService } from "../services/developerServiceFee.service.js";

// GET /api/developer/service-fee — exclusivo DEVELOPER (ver
// developerServiceFee.routes.js). Sólo lectura.
export const getServiceFeeConfig = async (req, res, next) => {
    try {
        const config = await getServiceFeeConfigService();
        res.status(200).json(config);
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/service-fee — reemplaza el conjunto COMPLETO de
// rangos de forma atómica. req.dbUser ya viene resuelto por requireRole
// (ver middlewares/requireRole.js) — nunca se vuelve a resolver acá.
export const updateServiceFeeConfig = async (req, res, next) => {
    try {
        const { tiers } = req.body;
        const config = await updateServiceFeeConfigService(req.dbUser.id, tiers);
        res.status(200).json(config);
    } catch (error) {
        next(AppError.from(error));
    }
};
