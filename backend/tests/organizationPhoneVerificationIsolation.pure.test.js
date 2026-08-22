import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bug real de producción — el organizador intentó cambiar/verificar su
// WhatsApp de CONTACTO (Organization.phone, flujo nuevo: OTP por email +
// deep link + CONFIRMAR <token>) y terminó disparando
// POST /api/organizations/me/whatsapp-number/change/request
// (whatsappNumberChange.service.js), que SÍ depende de un template de
// Meta (WHATSAPP_OTP_TEMPLATE_NAME) y falló porque esa variable nunca se
// configuró — causa real: esa ruta/servicio es para un dominio DISTINTO
// (el número AUTORIZADO para administrar por chatbot,
// WhatsappOrganizerLink.waId, ver WhatsappNumberChangeCard.jsx), no un bug
// de acoplamiento en el código del flujo de contacto — pero estos tests
// existen para que, si alguna vez SÍ lo hubiera, fallen fuerte acá antes
// de llegar a producción. Lectura de archivos fuente como texto — pura,
// sin DB, sin red, corre bajo test:unit.

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(testsDir, "..");
const repoRoot = path.join(backendRoot, "..");

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("organizationPhoneVerification.service.js never IMPORTS anything from whatsappNumberChange.service.js (comments mentioning it for cross-reference are fine — only a real import statement would mean it actually calls into that other domain)", () => {
    const source = readSource("backend/src/services/organizationPhoneVerification.service.js");
    assert.doesNotMatch(source, /^\s*import\s.*whatsappNumberChange\.service\.js/m);
});

test("organizationPhoneVerification.service.js never references the WhatsApp OTP template (that dependency belongs exclusively to the bot-admin number flow)", () => {
    const source = readSource("backend/src/services/organizationPhoneVerification.service.js");
    assert.doesNotMatch(source, /sendWhatsappOtpTemplate/);
    assert.doesNotMatch(source, /WHATSAPP_OTP_TEMPLATE_NAME/);
    assert.doesNotMatch(source, /getWhatsappOtpTemplateName/);
});

test("organizationPhoneVerificationApi.js (contact WhatsApp) never calls the legacy /whatsapp-number/ endpoints", () => {
    const source = readSource("frontend/src/lib/organizationPhoneVerificationApi.js");
    assert.doesNotMatch(source, /\/whatsapp-number\//);
});

test("OrganizationPhoneVerificationCard.jsx (contact WhatsApp) never imports the legacy organizationWhatsappApi.js (bot-admin number)", () => {
    const source = readSource("frontend/src/pages/organizer/OrganizationPhoneVerificationCard.jsx");
    assert.doesNotMatch(source, /organizationWhatsappApi\.js/);
});

test("organization.routes.js keeps the two domains on distinct sub-paths: /me/phone-verification/* (contact) vs /me/whatsapp-number/* (bot-admin)", () => {
    const source = readSource("backend/src/routes/organization.routes.js");
    const phoneVerificationRoutes = [...source.matchAll(/"(\/me\/phone-verification[^"]*)"/g)].map((m) => m[1]);
    const whatsappNumberRoutes = [...source.matchAll(/"(\/me\/whatsapp-number[^"]*)"/g)].map((m) => m[1]);
    assert.ok(phoneVerificationRoutes.length > 0, "esperaba encontrar rutas /me/phone-verification/*");
    assert.ok(whatsappNumberRoutes.length > 0, "esperaba encontrar rutas /me/whatsapp-number/*");
    for (const route of phoneVerificationRoutes) {
        assert.ok(!route.startsWith("/me/whatsapp-number"), `ruta de contacto mal ubicada: ${route}`);
    }
});
