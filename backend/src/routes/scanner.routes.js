import { Router } from "express";
import { validateScan, previewScan } from "../controllers/scanner.controller.js";
import {
    listScannerEvents,
    getFunctionStats,
    listScanAttempts,
    getScannerDashboard,
} from "../controllers/scannerRead.controller.js";
import { requireScannerSession } from "../middlewares/requireScannerSession.js";

const router = Router();

// Sin Clerk en ninguna ruta de acá: la única prueba de identidad es el
// scannerSessionToken (ver requireScannerSession.js), que además vuelve a
// chequear en la base que el EventScanner siga ACTIVE en cada request —
// desactivar/revocar/eliminar desde el panel del organizador invalida el
// acceso de inmediato, sin depender de que el token venza solo.
router.get("/dashboard", requireScannerSession, getScannerDashboard);
router.get("/events", requireScannerSession, listScannerEvents);
router.get("/events/:eventId/functions/:functionId/stats", requireScannerSession, getFunctionStats);
router.get("/scan-attempts", requireScannerSession, listScanAttempts);
// scan-preview: paso 1 (sólo lectura, ver previewScanService) del flujo de
// confirmación en dos fases. validate sigue siendo el único punto que
// escribe — sin cambios en su contrato.
router.post("/scan-preview", requireScannerSession, previewScan);
router.post("/validate", requireScannerSession, validateScan);

export default router;
