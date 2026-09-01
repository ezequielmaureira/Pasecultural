import { Router } from "express";
import {
    createOrganization,
    getMyOrganization,
    updateMyOrganization,
    deleteMyOrganization,
    getOrganizations,
    getOrganizationById,
    updateOrganizationStatus,
    updateOrganizationPlan,
    deleteOrganization,
    getPublicOrganizationBySlug,
} from "../controllers/organization.controller.js";
import { getWhatsappLinkStatus, linkWhatsappOrganizer, getWhatsappEventCreationLink } from "../controllers/organizationWhatsapp.controller.js";
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
import { requirePublicLaunch } from "../middlewares/requirePublicLaunch.js";

const router = Router();

// Premium — Fase 2D. Mismo patrón exacto que event.routes.js: prefijo fijo
// "/public" montado ANTES de "/:id" para que Express nunca lo confunda con
// una ruta parametrizada, y requirePublicLaunch reutilizado tal cual (mismo
// gate de "Modo Prelanzamiento" que ya protege el resto del contenido
// comercial público).
router.use("/public", requirePublicLaunch);
router.get("/public/:slug", getPublicOrganizationBySlug);

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

// Botón flotante global "Cargá tu evento con WhatsApp" (panel Organizer,
// ver OrganizerWhatsAppShortcutButton.jsx) — sólo arma la URL wa.me con el
// número oficial ya configurado (WHATSAPP_DISPLAY_PHONE_NUMBER). El gating
// FREE/PREMIUM real sigue viviendo en el bot (whatsapp.controller.js), no
// acá: ver el comentario del controller.
router.get("/me/whatsapp-event-link", requireRole("ORGANIZER"), getWhatsappEventCreationLink);

// Las rutas /me/whatsapp-number/change/* (número de WhatsApp autorizado
// del chatbot, OTP-vía-WhatsApp) fueron RETIRADAS — ver el informe de
// entrega "unificación WhatsApp": el número autorizado ahora se sincroniza
// automáticamente con /me/phone-verification/* (más abajo), nunca un
// segundo flujo/endpoint paralelo.

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
// Premium — Fase 1: administración manual exclusiva de DEVELOPER (ver
// organization.service.js#updateOrganizationPlanService). No hay ningún
// endpoint equivalente para ORGANIZER — su plan sólo se lee, nunca vía
// PATCH /me (ver UPDATABLE_FIELDS, que deliberadamente nunca incluye
// plan/planUpdatedAt/planUpdatedByUserId).
router.patch("/:id/plan", requireRole("DEVELOPER"), updateOrganizationPlan);
router.delete("/:id", requireRole("DEVELOPER"), deleteOrganization);

export default router;
