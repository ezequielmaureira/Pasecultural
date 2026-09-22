import { Router } from "express";
import { getQaChecklist, updateQaChecklistItem } from "../controllers/developerQaChecklist.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

// Mismo prefijo "/api/developer" que el resto de los routers Developer —
// Developer > QA / Checklist: GET /api/developer/qa-checklist (catálogo +
// estado + estadísticas) y PATCH /api/developer/qa-checklist/:key
// (tildar/destildar UNA funcionalidad, body { checked: true|false }). Sólo
// DEVELOPER — ni ORGANIZER, ni SCANNER, ni CUSTOMER pueden ver ni editar
// esto. Ver qaChecklistCatalog.js (definiciones, versionadas en código) y
// qaChecklist.service.js (estado, persistido en la base).
const router = Router();

router.get("/qa-checklist", requireRole("DEVELOPER"), getQaChecklist);
router.patch("/qa-checklist/:key", requireRole("DEVELOPER"), updateQaChecklistItem);

export default router;
