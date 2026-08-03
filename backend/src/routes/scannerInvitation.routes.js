import { Router } from "express";
import { getScannerInvitation, claimScannerInvitation } from "../controllers/scannerInvitation.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// Sin requireAuth a propósito: la pantalla de invitación tiene que poder
// mostrar "vas a operar como scanner de X" antes del login (ver
// scannerInvitation.controller.js#getScannerInvitation).
router.get("/:token", getScannerInvitation);
router.post("/:token/claim", requireAuth, claimScannerInvitation);

export default router;
