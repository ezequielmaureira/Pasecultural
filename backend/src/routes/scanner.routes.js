import { Router } from "express";
import { checkIn, scanTicket } from "../controllers/scanner.controller.js";
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
// Dos momentos de negocio, dos rutas con nombre propio — ninguna de las dos
// describe cómo está implementada, describen QUÉ hacen:
//   POST /scan     -> escanear (sólo lectura, ver scanTicketService)
//   POST /check-in -> confirmar el ingreso (el único que escribe, ver
//                     checkInService) — mismo nombre que el modelo CheckIn
router.post("/scan", requireScannerSession, scanTicket);
router.post("/check-in", requireScannerSession, checkIn);

export default router;
