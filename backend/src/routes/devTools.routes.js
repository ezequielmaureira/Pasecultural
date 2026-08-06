import { Router } from "express";
import { getDevDatabaseStats, resetDevDatabase, createDemoEvent } from "../controllers/devTools.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

// Protección simplificada TEMPORALMENTE (todavía no hay producción con
// clientes reales — sólo un DEVELOPER, un ORGANIZER, un email de prueba de
// Resend y un scanner de prueba). Única condición: requireRole("DEVELOPER")
// (ya incluye el chequeo de autenticación, 401 si no hay sesión). Antes
// también exigía requireDevelopmentEnv (NODE_ENV) y después
// DEV_TOOLS_ENABLED — ese middleware sigue existiendo
// (middlewares/requireDevelopmentEnv.js) sin usarse acá a propósito: hay
// que reincorporar una capa extra el día que haya clientes reales, y no
// hace falta reescribirla desde cero.
router.get("/stats", requireRole("DEVELOPER"), getDevDatabaseStats);
router.post("/reset", requireRole("DEVELOPER"), resetDevDatabase);
router.post("/demo-event", requireRole("DEVELOPER"), createDemoEvent);

export default router;
