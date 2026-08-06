import { Router } from "express";
import { getDevDatabaseStats, resetDevDatabase, createDemoEvent } from "../controllers/devTools.controller.js";
import { requireRole } from "../middlewares/requireRole.js";
import { requireDevelopmentEnv } from "../middlewares/requireDevelopmentEnv.js";

const router = Router();

// requireRole ya incluye el chequeo de autenticación (401 si no hay
// sesión). requireDevelopmentEnv va DESPUÉS del rol a propósito: primero
// se confirma que quien pide esto es un DEVELOPER real (401/403 de
// autorización), y recién ahí se evalúa el entorno — así un 403 por
// "estamos en producción" nunca revela nada a alguien que ni siquiera
// tiene el rol correcto.
router.get("/stats", requireRole("DEVELOPER"), requireDevelopmentEnv, getDevDatabaseStats);
router.post("/reset", requireRole("DEVELOPER"), requireDevelopmentEnv, resetDevDatabase);
router.post("/demo-event", requireRole("DEVELOPER"), requireDevelopmentEnv, createDemoEvent);

export default router;
