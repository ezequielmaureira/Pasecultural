import { AppError } from "../errors/AppError.js";
import { getPublicLaunchSettingsService, setPublicLaunchEnabledService, isPublicLaunchEnabledOrDefault } from "../services/publicLaunchSettings.service.js";

// GET /api/developer/launch-status — exclusivo DEVELOPER (ver
// publicLaunchSettings.routes.js). Sólo lectura, para el panel.
export const getDeveloperLaunchStatus = async (req, res, next) => {
    try {
        const settings = await getPublicLaunchSettingsService();
        res.status(200).json(settings);
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/launch-status — cambia el estado público de forma
// atómica. req.dbUser ya viene resuelto por requireRole.
export const updateDeveloperLaunchStatus = async (req, res, next) => {
    try {
        const settings = await setPublicLaunchEnabledService(req.dbUser.id, req.body?.publicLaunchEnabled);
        res.status(200).json(settings);
    } catch (error) {
        next(AppError.from(error));
    }
};

// GET /api/public/launch-status — SIN auth a propósito: un visitante
// anónimo (o el propio frontend antes de que Clerk resuelva sesión)
// necesita poder leer esto para decidir si muestra "Próximamente" o la
// superficie pública real. Reusa el mismo booleano fail-closed que el
// resto del sistema — nunca revela más que eso.
export const getPublicLaunchStatus = async (req, res) => {
    const publicLaunchEnabled = await isPublicLaunchEnabledOrDefault();
    res.status(200).json({ publicLaunchEnabled });
};
