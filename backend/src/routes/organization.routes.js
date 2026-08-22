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
import {
    getWhatsappLinkStatus,
    linkWhatsappOrganizer,
    getWhatsappNumberChangeStatus,
    requestWhatsappNumberChange,
    verifyWhatsappNumberChange,
    resendWhatsappNumberChangeOtp,
    cancelWhatsappNumberChange,
} from "../controllers/organizationWhatsapp.controller.js";
import { getMercadoPagoStatus, startMercadoPagoConnect, disconnectMercadoPagoConnection } from "../controllers/organizationMercadoPago.controller.js";
import {
    getOrganizationPhoneStatus,
    requestOrganizationPhoneVerification,
    verifyOrganizationPhoneChangeOtp,
    resendOrganizationPhoneWhatsapp,
    resendOrganizationPhoneChangeOtp,
    cancelOrganizationPhoneChange,
    deleteOrganizationPhone,
} from "../controllers/organizationPhoneVerification.controller.js";
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

// Cambio de número de WhatsApp autorizado — mismo sub-recurso "/me", mismo
// requireRole("ORGANIZER"). organizationId SIEMPRE viaja explícito (body/
// query) y SIEMPRE se revalida contra la sesión autenticada dentro de cada
// service (ver whatsappNumberChange.service.js) — nunca se infiere con
// findFirst, a diferencia del resto de las rutas /me de este router.
router.get("/me/whatsapp-number", requireRole("ORGANIZER"), getWhatsappNumberChangeStatus);
router.post("/me/whatsapp-number/change/request", requireRole("ORGANIZER"), requestWhatsappNumberChange);
router.post("/me/whatsapp-number/change/verify", requireRole("ORGANIZER"), verifyWhatsappNumberChange);
router.post("/me/whatsapp-number/change/resend", requireRole("ORGANIZER"), resendWhatsappNumberChangeOtp);
router.post("/me/whatsapp-number/change/cancel", requireRole("ORGANIZER"), cancelWhatsappNumberChange);

// MP-1 — onboarding OAuth de Mercado Pago, mismo sub-recurso "/me", mismo
// requireRole("ORGANIZER"). organizationId viaja explícito (query) y
// SIEMPRE se revalida contra la sesión autenticada dentro de cada service
// (ver mercadoPagoConnection.service.js) — nunca se infiere con findFirst.
// El callback público (Mercado Pago -> navegador del organizador) vive
// aparte, en mercadoPago.routes.js, montado en /api/mercadopago.
router.get("/me/mercadopago/status", requireRole("ORGANIZER"), getMercadoPagoStatus);
router.get("/me/mercadopago/connect", requireRole("ORGANIZER"), startMercadoPagoConnect);
// Bug fix (desconexión de Mercado Pago) — POST porque muta estado, mismo
// criterio que /me/whatsapp-number/change/cancel.
router.post("/me/mercadopago/disconnect", requireRole("ORGANIZER"), disconnectMercadoPagoConnection);

// Verificación de teléfono/WhatsApp de Organización — mismo sub-recurso
// "/me", mismo requireRole("ORGANIZER"). organizationId SIEMPRE viaja
// explícito (body/query) y SIEMPRE se revalida contra la sesión
// autenticada dentro de cada service (ver
// organizationPhoneVerification.service.js#resolveOrganizationForOwnerOrThrow)
// — nunca se infiere con findFirst. UN SOLO mecanismo para alta nueva y
// cambio: el service decide solo, mirando phoneVerifiedAt, si hace falta
// el paso de OTP por email antes del WhatsApp.
router.get("/me/phone-verification", requireRole("ORGANIZER"), getOrganizationPhoneStatus);
router.post("/me/phone-verification/request", requireRole("ORGANIZER"), requestOrganizationPhoneVerification);
router.post("/me/phone-verification/email-otp/verify", requireRole("ORGANIZER"), verifyOrganizationPhoneChangeOtp);
router.post("/me/phone-verification/email-otp/resend", requireRole("ORGANIZER"), resendOrganizationPhoneChangeOtp);
router.post("/me/phone-verification/whatsapp/resend", requireRole("ORGANIZER"), resendOrganizationPhoneWhatsapp);
router.post("/me/phone-verification/cancel", requireRole("ORGANIZER"), cancelOrganizationPhoneChange);
// Eliminar el teléfono oficial (verificado o no) — deliberadamente
// DISTINTO de /cancel: cancel sólo descarta un intento EN CURSO y nunca
// toca Organization.phone; esto sí lo hace (ver el informe de entrega).
router.post("/me/phone-verification/delete", requireRole("ORGANIZER"), deleteOrganizationPhone);

router.get("/", requireRole("DEVELOPER"), getOrganizations);
router.get("/:id", requireRole("DEVELOPER"), getOrganizationById);
router.patch("/:id/status", requireRole("DEVELOPER"), updateOrganizationStatus);
router.delete("/:id", requireRole("DEVELOPER"), deleteOrganization);

export default router;
