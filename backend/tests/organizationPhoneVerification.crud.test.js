import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createOrganizationService } from "../src/services/organization.service.js";
import {
    requestOrganizationPhoneVerificationService,
    verifyOrganizationPhoneChangeOtpService,
    resendOrganizationPhoneWhatsappService,
    resendOrganizationPhoneChangeOtpService,
    cancelOrganizationPhoneChangeService,
    deleteOrganizationPhoneService,
    getOrganizationPhoneStatusService,
    confirmOrganizationPhoneFromWebhook,
} from "../src/services/organizationPhoneVerification.service.js";
import { buildOrganizationContact } from "../src/services/withdrawalRequest.service.js";

// Verificación de teléfono/WhatsApp de Organización — flujo INVERTIDO (el
// organizador inicia la conversación de WhatsApp hacia PaseCultural, ver el
// pedido de cambio de diseño) — CRUD real + hooks contra Postgres real
// (backend/.env.test), mismo criterio que organizerNotifications.crud.test.js/
// withdrawalRequest.crud.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
//
// NO EJECUTADO todavía (el usuario pidió explícitamente no correr test:db
// esta ronda) — queda escrito y registrado en dbTestFiles.js para la
// próxima corrida autorizada. NO cubierto acá (ver el informe de entrega):
// el branch real dentro de processInboundMessage/whatsapp.controller.js
// (requeriría simular un webhook HTTP completo con firma HMAC válida — más
// apropiado como un test de integración HTTP separado), y el rate limit de
// reissue bajo concurrencia real (cubierto indirectamente por el mismo
// patrón ya probado en developerAlertConfig.crud.test.js para
// tryClaimDeveloperAlertCooldown, que usa el mismo mecanismo CAS).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

process.env.TICKET_QR_SECRET_KEY = process.env.TICKET_QR_SECRET_KEY || Buffer.alloc(32, 7).toString("base64");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// El deep link nunca guarda el token en la base (sólo su hash) — en los
// tests, la única forma de obtener el token para simular el webhook de
// Meta es extraerlo del propio deep link que devolvió el service, EXACTO
// mismo dato que vería el organizador real al abrir el link.
function extractTokenFromDeepLink(deepLink) {
    const url = new URL(deepLink);
    const text = url.searchParams.get("text");
    const match = /^CONFIRMAR (.+)$/.exec(text ?? "");
    if (!match) throw new Error(`deep link sin token: ${deepLink}`);
    return match[1];
}

// Sólo el email OTP manda algo real (Resend) — el WhatsApp ya NO manda
// nada (flujo invertido), así que no hace falta mockear graph.facebook.com.
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

testWithDb("a new organization with a phone starts PENDING (phoneVerifiedAt null) and never issues a WhatsApp challenge on its own (no auto-send)", async () => {
    const owner = await createUser();
    // Sin mock de fetch: cualquier intento de red real fallaría el test —
    // exactamente lo que este test quiere probar: la creación no manda nada.
    const { organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE });
    try {
        assert.equal(organization.phone, ARG_PHONE);
        assert.equal(organization.phoneVerifiedAt, null);
        const pending = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pending, null, "el alta de organización nunca debe crear un challenge de WhatsApp por su cuenta");
    } finally {
        await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("requesting verification for a new organization returns a wa.me deep link with CONFIRMAR + token prefilled, never sends anything", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));

        const result = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        assert.equal(result.step, "WHATSAPP_PENDING");
        assert.match(result.deepLink, /^https:\/\/wa\.me\/5493511234567\?text=CONFIRMAR%20[A-Z0-9]+$/);

        const status = await getOrganizationPhoneStatusService(owner.clerkId, organization.id);
        assert.equal(status.pendingPhone, ARG_PHONE);
        assert.ok(status.pendingExpiresAt);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("CONFIRMAR <token> from the exact registered number verifies the phone; a wrong number or a wrong token never does", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        // Token correcto, número DISTINTO nunca confirma.
        const wrongNumber = await confirmOrganizationPhoneFromWebhook({ waId: "5491111111111", token });
        assert.equal(wrongNumber.confirmed, false);

        // Número correcto, token INCORRECTO nunca confirma.
        const wrongToken = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: "NOTTHERIGHTTOKEN" });
        assert.equal(wrongToken.confirmed, false);

        const stillPending = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillPending.phoneVerifiedAt, null);

        // Ambos correctos a la vez: confirma.
        const result = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token });
        assert.equal(result.confirmed, true);
        assert.equal(result.organizationId, organization.id);
        const verified = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.ok(verified.phoneVerifiedAt);
        assert.equal(verified.phone, ARG_PHONE);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a repeated CONFIRMAR (same token, after already verified) is a safe no-op — idempotent, never errors", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        const first = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token });
        assert.equal(first.confirmed, true);

        // La fila ya se borró al confirmar — un segundo CONFIRMAR con el
        // mismo token no encuentra nada que aplicar de nuevo.
        const second = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token });
        assert.equal(second.confirmed, false);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("an expired pending verification is never confirmed by a late CONFIRMAR", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        await prisma.organizationPhoneVerification.update({
            where: { organizationId: organization.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const result = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token });
        assert.equal(result.confirmed, false);
        const stillPending = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillPending.phoneVerifiedAt, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

// --- Ambigüedad entre organizaciones (sección crítica del pedido) ---

testWithDb("two organizations pending verification for the SAME phone number never get verified together by one CONFIRMAR — the token disambiguates", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let orgA, orgB;
    try {
        ({ organization: orgA } = await createOrganizationService(ownerA.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        ({ organization: orgB } = await createOrganizationService(ownerB.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));

        // Las dos organizaciones, de buena fe, están verificando EL MISMO
        // número de WhatsApp al mismo tiempo (mismo pendingWaId).
        const { deepLink: deepLinkA } = await requestOrganizationPhoneVerificationService(ownerA.clerkId, orgA.id, ARG_PHONE);
        const { deepLink: deepLinkB } = await requestOrganizationPhoneVerificationService(ownerB.clerkId, orgB.id, ARG_PHONE);
        const tokenA = extractTokenFromDeepLink(deepLinkA);
        const tokenB = extractTokenFromDeepLink(deepLinkB);
        assert.notEqual(tokenA, tokenB, "cada organización debe recibir un token distinto aunque el número candidato sea el mismo");

        // El CONFIRMAR real trae el token de A: sólo A queda verificada.
        const result = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: tokenA });
        assert.equal(result.confirmed, true);
        assert.equal(result.organizationId, orgA.id);

        const refreshedA = await prisma.organization.findUnique({ where: { id: orgA.id } });
        const refreshedB = await prisma.organization.findUnique({ where: { id: orgB.id } });
        assert.ok(refreshedA.phoneVerifiedAt, "A debe quedar verificada");
        assert.equal(refreshedB.phoneVerifiedAt, null, "B NUNCA debe quedar verificada por el CONFIRMAR de A");

        // B todavía puede confirmarse con SU PROPIO token.
        const resultB = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: tokenB });
        assert.equal(resultB.confirmed, true);
        assert.equal(resultB.organizationId, orgB.id);
        const finalB = await prisma.organization.findUnique({ where: { id: orgB.id } });
        assert.ok(finalB.phoneVerifiedAt);
    } finally {
        restoreEnv();
        await cleanup({ organizationIds: [orgA?.id, orgB?.id].filter(Boolean), userIds: [ownerA.id, ownerB.id] });
    }
});

// --- Cambio de teléfono ya verificado ---

testWithDb("changing an already-verified phone never touches the old number until the email OTP is authorized", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        let result;
        try {
            result = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        } finally {
            restoreFetch();
        }
        assert.equal(result.step, "EMAIL_OTP_REQUIRED");

        const untouched = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(untouched.phone, ARG_PHONE, "el teléfono verificado no debe tocarse mientras el OTP de email sigue pendiente");
        assert.ok(untouched.phoneVerifiedAt);

        // Tampoco existe todavía ningún challenge de WhatsApp para el nuevo
        // número — recién se crea después de un OTP correcto.
        const pendingWhatsapp = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pendingWhatsapp, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a correct email OTP returns a wa.me deep link for the new number; CONFIRMAR <token> from it then replaces the old one", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink: firstDeepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(firstDeepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        let verifyResult;
        try {
            await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
            const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
            const { hashVerificationCode } = await import("../src/utils/verificationCode.js");
            const knownCode = "654321";
            await prisma.organizationPhoneChangeAuthorization.update({ where: { id: authorization.id }, data: { codeHash: hashVerificationCode(knownCode) } });

            verifyResult = await verifyOrganizationPhoneChangeOtpService(owner.clerkId, organization.id, knownCode);
        } finally {
            restoreFetch();
        }
        assert.equal(verifyResult.step, "WHATSAPP_PENDING");
        assert.match(verifyResult.deepLink, /^https:\/\/wa\.me\/5493511234567\?text=CONFIRMAR%20[A-Z0-9]+$/);

        // El OTP quedó consumido (no reutilizable) y el teléfono viejo
        // SIGUE siendo el oficial hasta que llegue el CONFIRMAR real.
        const stillOld = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillOld.phone, ARG_PHONE);
        const authorizationGone = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        assert.equal(authorizationGone, null);

        const confirmResult = await confirmOrganizationPhoneFromWebhook({ waId: "5493515557890", token: extractTokenFromDeepLink(verifyResult.deepLink) });
        assert.equal(confirmResult.confirmed, true);
        const swapped = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(swapped.phone, ARG_PHONE_2);
        assert.ok(swapped.phoneVerifiedAt > stillOld.phoneVerifiedAt);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("an incorrect email OTP is rejected and never authorizes a WhatsApp verification", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        try {
            await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);

            await assert.rejects(
                () => verifyOrganizationPhoneChangeOtpService(owner.clerkId, organization.id, "000000"),
                (err) => {
                    assert.equal(err.code, "ORGANIZATION_PHONE_OTP_CODE_INVALID");
                    return true;
                }
            );
        } finally {
            restoreFetch();
        }

        const pendingWhatsapp = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pendingWhatsapp, null, "un OTP incorrecto nunca debe crear un challenge de WhatsApp");
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("cancelling a change discards the pending attempt and leaves the verified phone untouched", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        try {
            await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        } finally {
            restoreFetch();
        }
        await cancelOrganizationPhoneChangeService(owner.clerkId, organization.id);

        const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        assert.equal(authorization, null);
        const untouched = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(untouched.phone, ARG_PHONE);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("resend respects the cooldown (rate limit) for the email OTP", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });

        const restoreFetch = mockResendFetchSuccessOnly();
        try {
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
        }
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("'Abrir WhatsApp nuevamente' reissues a fresh token (a new deep link) and respects the reissue cooldown", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink: firstDeepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);

        await assert.rejects(
            () => resendOrganizationPhoneWhatsappService(owner.clerkId, organization.id),
            (err) => {
                assert.equal(err.code, "ORGANIZATION_PHONE_RESEND_TOO_SOON");
                return true;
            }
        );

        // Fuera del cooldown: reemite un token nuevo. El viejo deja de
        // servir (fue reemplazado, no coexisten dos tokens vivos).
        await prisma.organizationPhoneVerification.update({
            where: { organizationId: organization.id },
            data: { lastIssuedAt: new Date(Date.now() - 61 * 1000) },
        });
        const reissued = await resendOrganizationPhoneWhatsappService(owner.clerkId, organization.id);
        assert.equal(reissued.step, "WHATSAPP_PENDING");
        assert.notEqual(reissued.deepLink, firstDeepLink);

        const oldToken = extractTokenFromDeepLink(firstDeepLink);
        const staleResult = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: oldToken });
        assert.equal(staleResult.confirmed, false, "el token viejo ya no debe servir después de reemitir");

        const newToken = extractTokenFromDeepLink(reissued.deepLink);
        const freshResult = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: newToken });
        assert.equal(freshResult.confirmed, true);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

// --- Seguridad / aislamiento ---

testWithDb("an organizer can never request, verify, or cancel another organization's phone verification (IDOR/BOLA)", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const restoreEnv = withMockedOutboundEnv();
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
            () => deleteOrganizationPhoneService(ownerA.clerkId, orgB.id),
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
        restoreEnv();
        await cleanup({ organizationIds: [orgA?.id, orgB?.id].filter(Boolean), userIds: [ownerA.id, ownerB.id] });
    }
});

// --- Eliminar teléfono (número no verificado o WhatsApp ya verificado) ---

testWithDb("an unverified pending phone can be deleted; afterwards phone and phoneVerifiedAt are both null and the old pending row is gone", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);

        const result = await deleteOrganizationPhoneService(owner.clerkId, organization.id);
        assert.equal(result.deleted, true);

        const cleared = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(cleared.phone, null);
        assert.equal(cleared.phoneVerifiedAt, null);

        const pending = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pending, null);

        const status = await getOrganizationPhoneStatusService(owner.clerkId, organization.id);
        assert.equal(status.phone, null);
        assert.equal(status.pendingPhone, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a token from a challenge deleted-before-confirming is permanently inert — the later CONFIRMAR never restores the phone", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        await deleteOrganizationPhoneService(owner.clerkId, organization.id);

        // El mensaje "CONFIRMAR <token>" llega DESPUÉS de eliminado — no
        // debe verificar ni restaurar nada.
        const result = await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token });
        assert.equal(result.confirmed, false);

        const stillCleared = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(stillCleared.phone, null);
        assert.equal(stillCleared.phoneVerifiedAt, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("deleting a phone twice in a row is idempotent — the second call is a safe no-op", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));

        const first = await deleteOrganizationPhoneService(owner.clerkId, organization.id);
        assert.equal(first.deleted, true);
        const second = await deleteOrganizationPhoneService(owner.clerkId, organization.id);
        assert.equal(second.deleted, true);

        const cleared = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(cleared.phone, null);
        assert.equal(cleared.phoneVerifiedAt, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("an already-verified WhatsApp can be explicitly deleted too; WithdrawalRequest falls back to email afterwards, never a stale/pending number", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });

        const verifiedOrg = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.ok(verifiedOrg.phoneVerifiedAt);
        // Antes de eliminar: WithdrawalRequest SÍ ofrecería WhatsApp.
        assert.ok(buildOrganizationContact(verifiedOrg, "Evento de prueba").whatsappUrl);

        const result = await deleteOrganizationPhoneService(owner.clerkId, organization.id);
        assert.equal(result.deleted, true);

        const cleared = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(cleared.phone, null);
        assert.equal(cleared.phoneVerifiedAt, null);

        const contact = buildOrganizationContact(cleared, "Evento de prueba");
        assert.equal(contact.whatsappUrl, null, "nunca debe ofrecer WhatsApp después de eliminarlo");
        assert.equal(contact.email, cleared.email);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("'Cancelar cambio' only discards the pending new number (B) — the already-verified number (A) is never touched", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        await confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token: extractTokenFromDeepLink(deepLink) });
        const verifiedA = await prisma.organization.findUnique({ where: { id: organization.id } });

        const restoreFetch = mockResendFetchSuccessOnly();
        try {
            await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE_2);
        } finally {
            restoreFetch();
        }

        await cancelOrganizationPhoneChangeService(owner.clerkId, organization.id);

        const afterCancel = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.equal(afterCancel.phone, ARG_PHONE, "A debe seguir siendo el oficial");
        assert.equal(afterCancel.phoneVerifiedAt.getTime(), verifiedA.phoneVerifiedAt.getTime(), "phoneVerifiedAt de A no debe tocarse");

        const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
        assert.equal(authorization, null);
        const pendingB = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pendingB, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("delete racing a concurrent CONFIRMAR never leaves an impossible state — whichever commits first fully determines the outcome", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedOutboundEnv();
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com`, phone: ARG_PHONE }));
        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);

        // "Ejecutados en simultáneo": ambas promesas arrancan antes de que
        // cualquiera de las dos resuelva. Postgres serializa las dos
        // transacciones sobre la misma fila de Organization — el resultado
        // final SIEMPRE es uno de dos consistentes, nunca un híbrido.
        const [deleteResult, confirmResult] = await Promise.all([
            deleteOrganizationPhoneService(owner.clerkId, organization.id),
            confirmOrganizationPhoneFromWebhook({ waId: "5493514123456", token }),
        ]);

        assert.equal(deleteResult.deleted, true);
        const finalOrg = await prisma.organization.findUnique({ where: { id: organization.id } });

        if (confirmResult.confirmed) {
            // CONFIRMAR ganó la carrera: verificó, y el delete (que corrió
            // después) volvió a limpiar ese mismo teléfono recién
            // verificado — resultado final igual: sin teléfono.
            assert.equal(finalOrg.phone, null);
            assert.equal(finalOrg.phoneVerifiedAt, null);
        } else {
            // Delete ganó la carrera: el CONFIRMAR no encontró nada para
            // reclamar.
            assert.equal(finalOrg.phone, null);
            assert.equal(finalOrg.phoneVerifiedAt, null);
        }
        // Ningún camino deja una fila de challenge huérfana.
        const pending = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
        assert.equal(pending, null);
    } finally {
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});
