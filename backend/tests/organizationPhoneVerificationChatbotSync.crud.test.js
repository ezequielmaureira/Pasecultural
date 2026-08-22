import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createOrganizationService } from "../src/services/organization.service.js";
import { requestOrganizationPhoneVerificationService, confirmOrganizationPhoneFromWebhook, deleteOrganizationPhoneService } from "../src/services/organizationPhoneVerification.service.js";
import { discoverWhatsappOrganizationCandidates } from "../src/services/whatsappOrganizerDiscovery.service.js";

// Unificación WhatsApp (ronda "arquitectura final") — Organization.phone
// verificado es ahora la ÚNICA fuente de identidad autorizada para
// administrar por chatbot: confirmOrganizationPhoneFromWebhook sincroniza
// WhatsappOrganizerLink automáticamente, atómico con la confirmación
// (nunca un segundo flujo/OTP-por-WhatsApp separado, ya retirado). Estos
// tests prueban esa sincronización end-to-end contra la infraestructura
// REAL que usa el bot (discoverWhatsappOrganizationCandidates), no un
// mock. Guardrail centralizado — ver tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía (el usuario pidió explícitamente no correr test:db
// esta ronda) — queda escrito y registrado en dbTestFiles.js para la
// próxima corrida autorizada.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 7).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function withMockedOutboundEnv() {
    const original = {
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
        FRONTEND_URL: process.env.FRONTEND_URL,
        WHATSAPP_DISPLAY_PHONE_NUMBER: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER,
    };
    process.env.RESEND_API_KEY = "test-mocked-resend-api-key";
    process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
    process.env.FRONTEND_URL = "https://pasecultural.test";
    process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = "5493511234567";
    return () => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

function mockResendFetchSuccessOnly() {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url} during a mocked test`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

function extractTokenFromDeepLink(deepLink) {
    const url = new URL(deepLink);
    const text = url.searchParams.get("text");
    const match = /^CONFIRMAR (.+)$/.exec(text ?? "");
    if (!match) throw new Error(`deep link sin token: ${deepLink}`);
    return match[1];
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function cleanup({ organizationIds = [], userIds = [], waIds = [] }) {
    await prisma.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: { in: waIds } } });
    await prisma.conversationState.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationPhoneVerification.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

const ARG_PHONE = "351 412-3456"; // waId 5493514123456
const ARG_PHONE_2 = "351 555-7890"; // waId 5493515557890
const WAID_A = "5493514123456";
const WAID_B = "5493515557890";

// --- 1/2/3: alta nueva — sin WhatsappOrganizerLink hasta confirmar; al
// confirmar, se crea y el chatbot resuelve correctamente. ---

testWithDb("1) before CONFIRMAR, a newly created organization with an unverified phone has no WhatsappOrganizerLink yet — the sync only happens as a result of verification, never before", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.equal(link, null, "un challenge pendiente (todavía no confirmado) nunca debe autorizar el chatbot");
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A] });
    }
});

testWithDb("2) a valid CONFIRMAR <token> creates a WhatsappOrganizerLink for the exact same verified number, atomically with the phone confirmation", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const result = await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(deepLink) });
        assert.equal(result.confirmed, true);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.ok(link, "el link autorizado debe existir apenas se confirma el teléfono");
        assert.equal(link.waId, WAID_A);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A] });
    }
});

testWithDb("3) once verified, the real chatbot discovery (discoverWhatsappOrganizationCandidates) resolves an inbound message from that number to the correct organization", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(deepLink) });

        const candidates = await discoverWhatsappOrganizationCandidates(WAID_A);
        assert.equal(candidates.length, 1);
        assert.equal(candidates[0].organizationId, organization.id);
        assert.equal(candidates[0].clerkId, owner.clerkId);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A] });
    }
});

// --- 4/5: cambio A→B — A autorizado hasta confirmar B; al confirmar B,
// el swap es atómico (A deja de resolver, B empieza). ---

testWithDb("4) changing A→B keeps A authorized for the chatbot until B is actually confirmed", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(deepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        try {
            await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        } finally {
            restoreFetch();
        }

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.equal(link.waId, WAID_A, "A debe seguir autorizado mientras B todavía no se confirmó");

        const candidatesForA = await discoverWhatsappOrganizationCandidates(WAID_A);
        assert.equal(candidatesForA.length, 1);
        assert.equal(candidatesForA[0].organizationId, organization.id);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A, WAID_B] });
    }
});

testWithDb("5) once B is confirmed, the authorization swaps atomically: B resolves to the organization, A no longer does — never both authorized at once", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink: firstDeepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(firstDeepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        let secondDeepLink;
        try {
            const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
            secondDeepLink = deepLink;
        } finally {
            restoreFetch();
        }
        const confirmResult = await confirmOrganizationPhoneFromWebhook({ waId: WAID_B, token: extractTokenFromDeepLink(secondDeepLink) });
        assert.equal(confirmResult.confirmed, true);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.equal(link.waId, WAID_B, "el link debe apuntar a B después del swap");

        const candidatesForB = await discoverWhatsappOrganizationCandidates(WAID_B);
        assert.equal(candidatesForB.length, 1);
        assert.equal(candidatesForB[0].organizationId, organization.id);

        // A ya NO debe resolver a esta organización vía link (puede seguir
        // devolviendo 0 candidatos, o candidatos de OTRAS organizaciones —
        // nunca ésta).
        const candidatesForA = await discoverWhatsappOrganizationCandidates(WAID_A);
        assert.ok(
            !candidatesForA.some((c) => c.organizationId === organization.id),
            "A no debe seguir administrando esta organización después del swap a B"
        );
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A, WAID_B] });
    }
});

// --- 6/7: eliminar revoca de inmediato, y un token viejo después de
// eliminar nunca restaura nada. ---

testWithDb("6) deleting the verified WhatsApp immediately revokes chatbot authorization — the number no longer resolves to this organization", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(deepLink) });

        await deleteOrganizationPhoneService(owner.clerkId, organization.id);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.equal(link, null, "el link autorizado debe desaparecer al eliminar el teléfono");

        // discoverWhatsappOrganizationCandidates no debe volver a
        // "descubrir" esta organización por teléfono: phone quedó null.
        const candidates = await discoverWhatsappOrganizationCandidates(WAID_A);
        assert.ok(!candidates.some((c) => c.organizationId === organization.id));
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A] });
    }
});

testWithDb("7) a challenge token from before the deletion is permanently inert afterwards — it can never create/restore a WhatsappOrganizerLink", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        await deleteOrganizationPhoneService(owner.clerkId, organization.id);

        const result = await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token });
        assert.equal(result.confirmed, false);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
        assert.equal(link, null, "un CONFIRMAR tardío nunca debe crear un link después de eliminar");
        const org = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(org.phone, null);
        assert.equal(org.phoneVerifiedAt, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id], waIds: [WAID_A] });
    }
});

// --- 8: IDOR — Organizer A nunca administra la organización de B. ---

testWithDb("8) verifying organization X's phone never creates/touches a WhatsappOrganizerLink for a different organization Y, even if Y's owner is a different user entirely", async () => {
    const ownerX = await createUser();
    const ownerY = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let orgX, orgY;
    try {
        ({ organization: orgX } = await createOrganizationService(ownerX.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        ({ organization: orgY } = await createOrganizationService(ownerY.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE_2 }));

        const { deepLink } = await requestOrganizationPhoneVerificationService(ownerX.clerkId, orgX.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: WAID_A, token: extractTokenFromDeepLink(deepLink) });

        const linkY = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: orgY.id } });
        assert.equal(linkY, null, "verificar X jamás debe crear/tocar un link para Y");
    } finally {
        restoreEnv();
        await cleanup({ organizationIds: [orgX?.id, orgY?.id].filter(Boolean), userIds: [ownerX.id, ownerY.id], waIds: [WAID_A, WAID_B] });
    }
});
