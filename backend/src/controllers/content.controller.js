import { AppError } from "../errors/AppError.js";
import {
    getContentCardService,
    updateContentCardService,
    getPublicContentCardService,
} from "../services/content.service.js";

const FEST_PASS_INTRO_PLACEMENT = "ORGANIZER_FEST_PASS_INTRO";
const HOW_IT_WORKS_ATTENDEES_PLACEMENT = "HOW_IT_WORKS_ATTENDEES";
const HOW_IT_WORKS_ORGANIZERS_PLACEMENT = "HOW_IT_WORKS_ORGANIZERS";

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

// GET /api/developer/content/how-it-works — exclusivo DEVELOPER. Agrupa las
// dos cards (attendees/organizers) de la página pública /como-funciona en
// una sola respuesta, reutilizando el mismo ContentCard genérico — no es un
// modelo nuevo, sólo dos placements leídos juntos por conveniencia de UI.
export const getHowItWorksContent = async (req, res, next) => {
    try {
        const [attendees, organizers] = await Promise.all([
            getContentCardService(HOW_IT_WORKS_ATTENDEES_PLACEMENT),
            getContentCardService(HOW_IT_WORKS_ORGANIZERS_PLACEMENT),
        ]);
        res.status(200).json({
            attendees: attendees ?? { placement: HOW_IT_WORKS_ATTENDEES_PLACEMENT, imageUrl: null, active: false },
            organizers: organizers ?? { placement: HOW_IT_WORKS_ORGANIZERS_PLACEMENT, imageUrl: null, active: false },
        });
    } catch (error) {
        next(AppError.from(error));
    }
};

// PUT /api/developer/content/how-it-works — exclusivo DEVELOPER. Recibe
// ambas configuraciones y las guarda como dos upserts independientes (cada
// placement sigue siendo una fila propia, @@unique en el schema).
export const updateHowItWorksContent = async (req, res, next) => {
    try {
        const { attendees, organizers } = req.body;
        const [attendeesCard, organizersCard] = await Promise.all([
            updateContentCardService(HOW_IT_WORKS_ATTENDEES_PLACEMENT, {
                imageUrl: attendees?.imageUrl,
                active: attendees?.active,
            }),
            updateContentCardService(HOW_IT_WORKS_ORGANIZERS_PLACEMENT, {
                imageUrl: organizers?.imageUrl,
                active: organizers?.active,
            }),
        ]);
        res.status(200).json({ attendees: attendeesCard, organizers: organizersCard });
    } catch (error) {
        next(AppError.from(error));
    }
};

// GET /api/content/how-it-works — público, sólo lectura (ver
// content.public.routes.js). Nunca expone más que { active, imageUrl } por
// pestaña.
export const getPublicHowItWorksContent = async (req, res, next) => {
    try {
        const [attendees, organizers] = await Promise.all([
            getPublicContentCardService(HOW_IT_WORKS_ATTENDEES_PLACEMENT),
            getPublicContentCardService(HOW_IT_WORKS_ORGANIZERS_PLACEMENT),
        ]);
        res.status(200).json({ attendees, organizers });
    } catch (error) {
        next(AppError.from(error));
    }
};
