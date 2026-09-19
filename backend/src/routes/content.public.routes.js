import { Router } from "express";
import { getPublicFestPassIntroContent, getPublicHowItWorksContent } from "../controllers/content.controller.js";

// Router propio, prefijo "/api/content" — SIN auth a propósito: lo
// consume cualquier Organizer (o visitante) al entrar a Fest Pass, no
// requiere rol Developer. Nunca exponer acá nada administrativo — ver
// content.controller.js (siempre devuelve sólo { active, imageUrl }).
const router = Router();

router.get("/fest-pass-intro", getPublicFestPassIntroContent);
router.get("/how-it-works", getPublicHowItWorksContent);

export default router;
