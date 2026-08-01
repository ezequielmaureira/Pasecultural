import { Router } from "express";
import { validateScan } from "../controllers/scanner.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.post("/validate", requireRole("SCANNER"), validateScan);

export default router;
