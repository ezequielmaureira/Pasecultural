import { Router } from "express";
import { syncUser, deleteMyAccount } from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

router.post("/sync", syncUser);
router.delete("/me", requireAuth, deleteMyAccount);

export default router;
