import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bug real de producción (ronda anterior) — el organizador intentó cambiar/
// verificar su WhatsApp de CONTACTO y terminó disparando el sistema VIEJO
// de "número autorizado" (whatsappNumberChange.service.js,
// WhatsappNumberChangeChallenge, WHATSAPP_OTP_TEMPLATE_NAME), que fallaba
// porque esa plantilla de Meta nunca se configuró. Esta ronda ("arquitectura
// final WhatsApp") RETIRA ese sistema por completo: ya no hay dos flujos
// compitiendo en Configuración — Organization.phone verificado es la única
// fuente de identidad de WhatsApp, sirve simultáneamente como contacto
// público y como número autorizado para administrar por chatbot (ver
// organizationPhoneVerification.service.js#syncWhatsappOrganizerLinkAfterVerification).
//
// Estos tests verifican, por lectura de archivos fuente como texto (pura,
// sin DB, sin red, corre bajo test:unit), que el retiro fue completo: ni
// una referencia funcional al sistema viejo debería seguir existiendo.

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(testsDir, "..");
const repoRoot = path.join(backendRoot, "..");

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fileExists(relativePath) {
    return fs.existsSync(path.join(repoRoot, relativePath));
}

test("whatsappNumberChange.service.js no longer exists", () => {
    assert.equal(fileExists("backend/src/services/whatsappNumberChange.service.js"), false);
});

test("WhatsappNumberChangeCard.jsx no longer exists", () => {
    assert.equal(fileExists("frontend/src/pages/organizer/WhatsappNumberChangeCard.jsx"), false);
});

test("organizationWhatsappApi.js (frontend, legacy number-change API) no longer exists", () => {
    assert.equal(fileExists("frontend/src/lib/organizationWhatsappApi.js"), false);
});

test("organizationPhoneVerification.service.js never IMPORTS anything from whatsappNumberChange.service.js (comments mentioning it for cross-reference/history are fine — only a real import statement would mean it actually calls into that other domain)", () => {
    const source = readSource("backend/src/services/organizationPhoneVerification.service.js");
    assert.doesNotMatch(source, /^\s*import\s.*whatsappNumberChange\.service\.js/m);
});

test("organizationPhoneVerification.service.js never references the WhatsApp OTP template (WHATSAPP_OTP_TEMPLATE_NAME/LANGUAGE) — the final flow never depends on any Meta template", () => {
    const source = readSource("backend/src/services/organizationPhoneVerification.service.js");
    assert.doesNotMatch(source, /sendWhatsappOtpTemplate/);
    assert.doesNotMatch(source, /WHATSAPP_OTP_TEMPLATE_NAME/);
    assert.doesNotMatch(source, /getWhatsappOtpTemplateName/);
});

test("whatsapp.service.js no longer exports getWhatsappOtpTemplateName/Language, sendWhatsappOtpTemplate, or the welcome-template functions, and no longer reads those env vars from process.env (all orphaned once whatsappNumberChange.service.js was retired — a comment documenting the removal is fine)", () => {
    const source = readSource("backend/src/services/whatsapp.service.js");
    assert.doesNotMatch(source, /export (async )?function (get|send)Whatsapp(Otp|Welcome)Template/);
    assert.doesNotMatch(source, /process\.env\.WHATSAPP_(OTP|WELCOME)_TEMPLATE_(NAME|LANGUAGE)/);
});

test("ErrorCatalog.js no longer defines any WHATSAPP_NUMBER_CHANGE_* error code (a comment mentioning the removed prefix for history is fine — only a real `KEY: {` catalog entry would mean the code still exists)", () => {
    const source = readSource("backend/src/errors/ErrorCatalog.js");
    assert.doesNotMatch(source, /WHATSAPP_NUMBER_CHANGE_\w+:\s*\{/);
});

test("organizationPhoneVerificationApi.js (contact WhatsApp) never calls the legacy /whatsapp-number/ endpoints", () => {
    const source = readSource("frontend/src/lib/organizationPhoneVerificationApi.js");
    assert.doesNotMatch(source, /\/whatsapp-number\//);
});

test("organization.routes.js no longer registers any router.*(/me/whatsapp-number/change/*) route — the only WhatsApp identity mechanism left is /me/phone-verification/* and the unrelated Fase 2F /me/whatsapp-link (a comment documenting the removal is fine — only a live router.get/post line would mean the route still exists)", () => {
    const source = readSource("backend/src/routes/organization.routes.js");
    assert.doesNotMatch(source, /router\.(get|post)\([^)]*\/me\/whatsapp-number\/change/);
    assert.match(source, /router\.post\("\/me\/phone-verification\/request"/, "esperaba seguir teniendo el flujo de contacto nuevo");
    assert.match(source, /router\.(get|post)\("\/me\/whatsapp-link"/, "el link Fase 2F es un dominio distinto, no debía tocarse");
});

test("organizationWhatsapp.controller.js no longer IMPORTS from whatsappNumberChange.service.js nor exports any WhatsApp number-change controller (a comment documenting the removal is fine — only a real import/export would mean the code still exists; only the unrelated Fase 2F link-by-code endpoints remain)", () => {
    const source = readSource("backend/src/controllers/organizationWhatsapp.controller.js");
    assert.doesNotMatch(source, /^\s*import\s.*whatsappNumberChange\.service\.js/m);
    assert.doesNotMatch(source, /export const (get|request|verify|resend|cancel)WhatsappNumberChange/);
    assert.match(source, /export const getWhatsappLinkStatus/, "Fase 2F no debía tocarse");
    assert.match(source, /export const linkWhatsappOrganizer\b/, "Fase 2F no debía tocarse");
});

test("OrganizerSettings.jsx no longer renders WhatsappNumberChangeCard — the Dashboard has a single WhatsApp card", () => {
    const source = readSource("frontend/src/pages/organizer/OrganizerSettings.jsx");
    assert.doesNotMatch(source, /WhatsappNumberChangeCard/);
    assert.match(source, /OrganizationPhoneVerificationCard/);
});
