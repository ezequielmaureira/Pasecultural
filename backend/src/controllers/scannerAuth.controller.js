import { AppError } from "../errors/AppError.js";
import {
    requestScannerLoginCodeService,
    resendScannerLoginCodeService,
    verifyScannerLoginCodeService,
} from "../services/scannerLogin.service.js";

// Portal Scanner — todo público, sin sesión: el login por email + código de
// 6 dígitos reemplaza a la invitación como forma de volver a entrar (ver
// scannerLogin.service.js). Mismo patrón try/catch + AppError.from que el
// resto de los controllers públicos del proyecto.

export const requestScannerLoginCode = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await requestScannerLoginCodeService({ email });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const resendScannerLoginCode = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await resendScannerLoginCodeService({ email });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};

export const verifyScannerLoginCode = async (req, res, next) => {
    try {
        const { email, code } = req.body;
        const result = await verifyScannerLoginCodeService({ email, code }, { userAgent: req.get("user-agent") });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
