import { Router } from "express";
import { syncUser } from "../controllers/auth.controller.js";

const router = Router();

router.post("/sync", syncUser);

export default router;