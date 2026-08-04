import { Router } from "express";
import { validateScan } from "../controllers/scanner.controller.js";
import {
    listScannerEvents,
    getFunctionStats,
    listScanAttempts,
} from "../controllers/scannerRead.controller.js";
import { requireScannerSession } from "../middlewares/requireScannerSession.js";

const router = Router();

// Sin Clerk en ninguna ruta de acá: la única prueba de identidad es el
// scannerSessionToken (ver requireScannerSession.js), que además vuelve a
// chequear en la base que el EventScanner siga ACTIVE en cada request —
// desactivar/revocar/eliminar desde el panel del organizador invalida el
// acceso de inmediato, sin depender de que el token venza solo.
router.get("/events", requireScannerSession, listScannerEvents);
router.get("/events/:eventId/functions/:functionId/stats", requireScannerSession, getFunctionStats);
router.get("/scan-attempts", requireScannerSession, listScanAttempts);
router.post("/validate", requireScannerSession, validateScan);

export default router;
