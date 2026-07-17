import { Router } from "express";
import {
    createOrganization,
    getMyOrganization,
    updateMyOrganization,
    deleteMyOrganization,
    getOrganizations,
    getOrganizationById,
    updateOrganizationStatus,
    deleteOrganization,
} from "../controllers/organization.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.get("/me", getMyOrganization);
router.patch("/me", updateMyOrganization);
router.delete("/me", deleteMyOrganization);
router.post("/", createOrganization);

router.get("/", requireRole("DEVELOPER"), getOrganizations);
router.get("/:id", requireRole("DEVELOPER"), getOrganizationById);
router.patch("/:id/status", requireRole("DEVELOPER"), updateOrganizationStatus);
router.delete("/:id", requireRole("DEVELOPER"), deleteOrganization);

export default router;
