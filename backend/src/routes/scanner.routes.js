import { Router } from "express";
import { confirmScan, scanTicket } from "../controllers/scanner.controller.js";
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
// Dos acciones del MISMO flujo, anidadas bajo /scan — ninguna describe cómo
// está implementada, describen QUÉ hacen. Deja el namespace preparado para
// futuras extensiones del mismo flujo sin romper la coherencia del dominio
// (ej. /scan/cancel, /scan/check-out para un futuro control de egresos):
//   POST /scan         -> escanear (sólo lectura, ver scanTicketService)
//   POST /scan/confirm -> confirmar el ingreso (el único que escribe, ver
//                         confirmScanService)
//
// Auditoría antes de renombrar (pedido explícito): el nombre anterior,
// POST /check-in, sólo lo usaba el propio scannerApi.js de este frontend —
// no hay ninguna otra integración, doc pública ni cliente externo que
// dependa de él, así que se renombra directo, sin alias deprecado.
router.post("/scan", requireScannerSession, scanTicket);
router.post("/scan/confirm", requireScannerSession, confirmScan);

export default router;
