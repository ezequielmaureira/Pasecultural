import { AppError } from "../errors/AppError.js";
import { getDeveloperDashboardService } from "../services/developerDashboard.service.js";

// Sólo valida req, llama al service y devuelve la respuesta — misma
// convención que el resto de los controllers. Platform-wide a propósito:
// no hay ningún `clerkId`/organización que resolver acá (a diferencia de
// los controllers de ORGANIZER), requireRole("DEVELOPER") ya alcanza.
export const getDeveloperDashboard = async (req, res, next) => {
    try {
        const dashboard = await getDeveloperDashboardService();
        res.status(200).json(dashboard);
    } catch (error) {
        next(AppError.from(error));
    }
};
