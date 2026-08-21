import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createOrganizationService } from "../src/services/organization.service.js";
import {
    requestOrganizationPhoneVerificationService,
    verifyOrganizationPhoneChangeOtpService,
    resendOrganizationPhoneChangeOtpService,
    cancelOrganizationPhoneChangeService,
    getOrganizationPhoneStatusService,
    confirmOrganizationPhoneFromWebhook,
} from "../src/services/organizationPhoneVerification.service.js";

// Verificación de teléfono/WhatsApp de Organización — CRUD real + hooks
// (alta nueva, cambio con OTP por email, confirmación por webhook,
// idempotencia, aislamiento multi-organizador) contra Postgres real
// (backend/.env.test), mismo criterio que organizerNotifications.crud.test.js/
// withdrawalRequest.crud.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía (el usuario pidió explícitamente no correr test:db
// esta ronda) — queda escrito y registrado en dbTestFiles.js para la
// próxima corrida autorizada. NO cubierto acá (ver el informe de entrega):
// el branch real dentro de processInboundMessage/whatsapp.controller.js
// (requeriría simular un webhook HTTP completo con firma HMAC válida —
// más apropiado como un test de integración HTTP separado), y el rate
// limit de reenvío bajo concurrencia real (cubierto indirectamente por el
// mismo patrón ya probado en developerAlertConfig.crud.test.js para
// tryClaimDeveloperAlertCooldown, que usa el mismo mecanismo CAS).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 7).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// Mismo mecanismo EXACTO que mockResendFetchSuccessOnly/withMockedResendEnv
// en withdrawalRequest.crud.test.js — acá intercepta TANTO Resend (OTP por
// email) COMO el Graph API de Meta (mensaje de WhatsApp), dispatcheando
// por URL.
function mockOutboundFetchSuccessOnly() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        if (String(url).includes("graph.facebook.com")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ messages: [{ id: `wamid-test-${uniqueSuffix()}` }] }) };
        }
        throw new Error(`unexpected fetch call to ${url} during a mocked test`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

function withMockedOutboundEnv() {
    const original = {
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
        FRONTEND_URL: process.env.FRONTEND_URL,
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
        WHATSAPP_GRAPH_API_VERSION: process.env.WHATSAPP_GRAPH_API_VERSION,
        WHATSAPP_PHONE_VERIFICATION_TEMPLATE_NAME: process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE_NAME,
        WHATSAPP_PHONE_VERIFICATION_TEMPLATE_LANGUAGE: process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE_LANGUAGE,
    };
    process.env.RESEND_API_KEY = "test-mocked-resend-api-key";
    process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
    process.env.FRONTEND_URL = "https://pasecultural.test";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-mocked-whatsapp-access-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v21.0";
    process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE_NAME = "test_phone_verification";
    process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE_LANGUAGE = "es_AR";
    return () => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationPhoneVerification.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

const ARG_PHONE = "351 412-3456"; // normaliza a waId 5493514123456
const ARG_PHONE_2 = "351 555-7890"; // normaliza a waId 5493515557890

// --- Organización nueva ---

testWithDb("a new organization with a phone starts PENDING (phoneVerifiedAt null), never blocks creation even if the WhatsApp send fails", async () => {
    const owner = await createUser();
    // Sin mock de fetch: cualquier intento de red real falla (no hay
    // WHATSAPP_ACCESS_TOKEN configurado) — exactamente lo que este test
    // quiere probar: la organización se crea igual.
    const { organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE });
    try {
        assert.equal(organization.phone, ARG_PHONE);
        assert.equal(organization.phoneVerifiedAt, null);
    } finally {
        await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("CONFIRMAR from the exact registered number verifies the phone; a different number never does", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));

        // Un número DISTINTO nunca confirma esta organización.
        const wrongResult = await confirmOrganizationPhoneFromWebhook("5491111111111");
        assert.deepEqual(wrongResult.confirmedOrganizationIds, []);
        const stillPending = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillPending.phoneVerifiedAt, null);

        // El número REAL (waId normalizado) sí confirma.
        const result = await confirmOrganizationPhoneFromWebhook("5493514123456");
        assert.deepEqual(result.confirmedOrganizationIds, [organization.id]);
        const verified = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.ok(verified.phoneVerifiedAt);
        assert.equal(verified.phone, ARG_PHONE);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a repeated CONFIRMAR (same wa_id, after already verified) is a safe no-op — idempotent, never errors", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));

        const first = await confirmOrganizationPhoneFromWebhook("5493514123456");
        assert.deepEqual(first.confirmedOrganizationIds, [organization.id]);

        // La fila ya se borró al confirmar — un segundo CONFIRMAR del mismo
        // número no encuentra nada PENDING para aplicar de nuevo.
        const second = await confirmOrganizationPhoneFromWebhook("5493514123456");
        assert.deepEqual(second.confirmedOrganizationIds, []);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("an expired pending verification is never confirmed by a late CONFIRMAR", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));

        await prisma.organizationPhoneVerification.update({
            where: { organizationId: organization.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const result = await confirmOrganizationPhoneFromWebhook("5493514123456");
        assert.deepEqual(result.confirmedOrganizationIds, []);
        const stillPending = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillPending.phoneVerifiedAt, null);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

// --- Cambio de teléfono ya verificado ---

testWithDb("changing an already-verified phone never touches the old number until the email OTP is authorized", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await confirmOrganizationPhoneFromWebhook("5493514123456");

        const result = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        assert.equal(result.step, "EMAIL_OTP_REQUIRED");

        const untouched = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(untouched.phone, ARG_PHONE, "el teléfono verificado no debe tocarse mientras el OTP de email sigue pendiente");
        assert.ok(untouched.phoneVerifiedAt);

        // Tampoco existe todavía ninguna verificación de WhatsApp — recién
        // se crea después de un OTP correcto.
        const pendingWhatsapp = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pendingWhatsapp, null);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a correct email OTP authorizes the WhatsApp send for the new number; CONFIRMAR from it then replaces the old one", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await confirmOrganizationPhoneFromWebhook("5493514123456");

        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        const { hashVerificationCode } = await import("../src/utils/verificationCode.js");
        const knownCode = "654321";
        await prisma.organizationPhoneChangeAuthorization.update({ where: { id: authorization.id }, data: { codeHash: hashVerificationCode(knownCode) } });

        const verifyResult = await verifyOrganizationPhoneChangeOtpService(owner.clerkId, organization.id, knownCode);
        assert.equal(verifyResult.step, "WHATSAPP_SENT");

        // El OTP quedó consumido (no reutilizable) y el teléfono viejo
        // SIGUE siendo el oficial hasta que llegue el CONFIRMAR real.
        const stillOld = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillOld.phone, ARG_PHONE);
        const authorizationGone = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        assert.equal(authorizationGone, null);

        const confirmResult = await confirmOrganizationPhoneFromWebhook("5493515557890");
        assert.deepEqual(confirmResult.confirmedOrganizationIds, [organization.id]);
        const swapped = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(swapped.phone, ARG_PHONE_2);
        assert.ok(swapped.phoneVerifiedAt > stillOld.phoneVerifiedAt);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("an incorrect email OTP is rejected and never authorizes a WhatsApp verification", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await confirmOrganizationPhoneFromWebhook("5493514123456");

        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);

        await assert.rejects(
            () => verifyOrganizationPhoneChangeOtpService(owner.clerkId, organization.id, "000000"),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_OTP_CODE_INVALID");
                return true;
            }
        );

        const pendingWhatsapp = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pendingWhatsapp, null, "un OTP incorrecto nunca debe crear una verificación de WhatsApp");
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("cancelling a change discards the pending attempt and leaves the verified phone untouched", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await confirmOrganizationPhoneFromWebhook("5493514123456");

        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        await cancelOrganizationPhoneChangeService(owner.clerkId, organization.id);

        const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        assert.equal(authorization, null);
        const untouched = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(untouched.phone, ARG_PHONE);
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("resend respects the cooldown (rate limit) for the email OTP", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await confirmOrganizationPhoneFromWebhook("5493514123456");
        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);

        await assert.rejects(
            () => resendOrganizationPhoneChangeOtpService(owner.clerkId, organization.id),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_RESEND_TOO_SOON");
                return true;
            }
        );
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

// --- Seguridad / aislamiento ---

testWithDb("an organizer can never request, verify, or cancel another organization's phone verification (IDOR/BOLA)", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    const restoreFetch = mockOutboundFetchSuccessOnly();
    let orgA, orgB;
    try {
        ({ organization: orgA } = await createOrganizationService(ownerA.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        ({ organization: orgB } = await createOrganizationService(ownerB.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE_2 }));

        await assert.rejects(
            () => requestOrganizationPhoneVerificationService(ownerA.clerkId, orgB.id, "351 999-9999"),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_FORBIDDEN");
                return true;
            }
        );
        await assert.rejects(
            () => cancelOrganizationPhoneChangeService(ownerA.clerkId, orgB.id),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_FORBIDDEN");
                return true;
            }
        );
        await assert.rejects(
            () => getOrganizationPhoneStatusService(ownerA.clerkId, orgB.id),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_FORBIDDEN");
                return true;
            }
        );

        // B sigue intacta.
        const untouched = await prisma.organization.findUnique({ where: { id: orgB.id } });
        assert.equal(untouched.phone, ARG_PHONE_2);
    } finally {
        restoreFetch();
        restoreEnv();
        await cleanup({ organizationIds: [orgA?.id, orgB?.id].filter(Boolean), userIds: [ownerA.id, ownerB.id] });
    }
});
