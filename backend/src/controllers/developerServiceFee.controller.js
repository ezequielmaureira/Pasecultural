import { AppError } from "../errors/AppError.js";
import { getServiceFeeConfigService, updateServiceFeeConfigService } from "../services/developerServiceFee.service.js";
import { getServiceFeeSettingsService, setServiceFeeWaiverDurationService } from "../services/serviceFeeWaiver.service.js";

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

// GET /api/developer/service-fee/buyer-benefit — duración del beneficio
// inicial para compradores (service_fee_settings). Exclusivo DEVELOPER.
export const getBuyerBenefitConfig = async (req, res, next) => {
    try {
        res.status(200).json(await getServiceFeeSettingsService());
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/service-fee/buyer-benefit — { serviceFeeWaiverDurationMonths }.
// Nunca recalcula beneficios ya iniciados (ver serviceFeeWaiver.service.js).
export const updateBuyerBenefitConfig = async (req, res, next) => {
    try {
        const config = await setServiceFeeWaiverDurationService(req.dbUser.id, req.body?.serviceFeeWaiverDurationMonths);
        res.status(200).json(config);
    } catch (error) {
        next(AppError.from(error));
    }
};
