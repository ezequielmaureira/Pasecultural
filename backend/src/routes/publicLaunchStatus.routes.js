import { Router } from "express";
import { getPublicLaunchStatus } from "../controllers/publicLaunchSettings.controller.js";

// Router propio, prefijo nuevo "/api/public" — SIN auth a propósito: lo
// necesita cualquier visitante anónimo (o el propio frontend antes de que
// Clerk resuelva sesión) para saber si mostrar "Próximamente" o la
// superficie pública real. Nunca agregar acá ningún otro endpoint que
// exponga datos comerciales/de eventos — ver el guard dedicado en
// event.routes.js (requirePublicLaunch) para eso.
const router = Router();

router.get("/launch-status", getPublicLaunchStatus);

export default router;
