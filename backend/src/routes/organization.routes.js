import { Router } from "express";
import {
    createOrganization,
    getMyOrganization,
} from "../controllers/organization.controller.js";

const router = Router();

router.get("/me", getMyOrganization);
router.post("/", createOrganization);

export default router;
