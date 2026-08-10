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
import { getWhatsappLinkStatus, linkWhatsappOrganizer } from "../controllers/organizationWhatsapp.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.get("/me", getMyOrganization);
router.patch("/me", updateMyOrganization);
router.delete("/me", deleteMyOrganization);
router.post("/", createOrganization);

// Fase 2F — vinculación WhatsApp, sub-recurso de "mi organización" (mismo
// patrón /me que el resto de este router). requireRole exige una sesión
// Clerk válida Y rol ORGANIZER antes de tocar el service — la organización
// puntual del usuario se resuelve adentro del service, nunca desde el body.
router.get("/me/whatsapp-link", requireRole("ORGANIZER"), getWhatsappLinkStatus);
router.post("/me/whatsapp-link", requireRole("ORGANIZER"), linkWhatsappOrganizer);

router.get("/", requireRole("DEVELOPER"), getOrganizations);
router.get("/:id", requireRole("DEVELOPER"), getOrganizationById);
router.patch("/:id/status", requireRole("DEVELOPER"), updateOrganizationStatus);
router.delete("/:id", requireRole("DEVELOPER"), deleteOrganization);

export default router;
