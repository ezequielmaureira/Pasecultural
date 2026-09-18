import { AppError } from "../errors/AppError.js";
import {
    getContentCardService,
    updateContentCardService,
    getPublicContentCardService,
} from "../services/content.service.js";

const FEST_PASS_INTRO_PLACEMENT = "ORGANIZER_FEST_PASS_INTRO";

// GET /api/developer/content/fest-pass-intro — exclusivo DEVELOPER (ver
// content.routes.js).
export const getFestPassIntroContent = async (req, res, next) => {
    try {
        const card = await getContentCardService(FEST_PASS_INTRO_PLACEMENT);
        res.status(200).json(card ?? { placement: FEST_PASS_INTRO_PLACEMENT, imageUrl: null, active: false });
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/content/fest-pass-intro — exclusivo DEVELOPER.
export const updateFestPassIntroContent = async (req, res, next) => {
    try {
        const { imageUrl, active } = req.body;
        const card = await updateContentCardService(FEST_PASS_INTRO_PLACEMENT, { imageUrl, active });
        res.status(200).json(card);
    } catch (error) {
        next(AppError.from(error));
    }
};

// GET /api/content/fest-pass-intro — público, sólo lectura (ver
// content.public.routes.js). Nunca expone más que { active, imageUrl }.
export const getPublicFestPassIntroContent = async (req, res, next) => {
    try {
        const card = await getPublicContentCardService(FEST_PASS_INTRO_PLACEMENT);
        res.status(200).json(card);
    } catch (error) {
        next(AppError.from(error));
    }
};
