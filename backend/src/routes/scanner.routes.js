import { Router } from "express";
import { validateScan } from "../controllers/scanner.controller.js";
import {
    listScannerEvents,
    getFunctionStats,
    listScanAttempts,
} from "../controllers/scannerRead.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// El acceso a "escanear" no depende de un rol de cuenta especial: cualquier
// usuario autenticado puede llamar a estas rutas — la autorización real
// (¿está habilitado para ESTE evento?) la resuelve EventScanner dentro de
// cada service (assertScannerAuthorized). Role.SCANNER queda en el enum de
// Prisma por compatibilidad, pero ya no gatea nada acá.
router.get("/events", requireAuth, listScannerEvents);
router.get("/events/:eventId/functions/:functionId/stats", requireAuth, getFunctionStats);
router.get("/scan-attempts", requireAuth, listScanAttempts);
router.post("/validate", requireAuth, validateScan);

export default router;
