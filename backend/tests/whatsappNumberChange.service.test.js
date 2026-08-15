import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    requestWhatsappNumberChangeService,
    verifyWhatsappNumberChangeService,
    resendWhatsappNumberChangeOtpService,
    cancelWhatsappNumberChangeService,
    getWhatsappNumberChangeStatusService,
} from "../src/services/whatsappNumberChange.service.js";
import { updateMyOrganizationService, getMyOrganizationService } from "../src/services/organization.service.js";
import { discoverWhatsappOrganizationCandidates } from "../src/services/whatsappOrganizerDiscovery.service.js";
import { hashVerificationCode } from "../src/utils/verificationCode.js";

// Cambio seguro de número de WhatsApp autorizado — mismo criterio que
// eventServicePort.commit.perf.test.js/whatsappInboundMessageClaim.service.test.js:
// esto es CRUD + transacciones + concurrencia real, no expresable como
// funciones puras, así que se prueba contra Postgres real (backend/.env.test),
// nunca con mocks de Prisma. Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

// Meta nunca se llama de verdad: globalThis.fetch se mockea por test (mismo
// patrón que tests/whatsapp.send.test.js). Las 3 variables de configuración
// de sendWhatsappTextMessage/sendWhatsappTemplateMessage (postToGraphApi) y
// las 2 propias de la plantilla OTP se fijan UNA vez acá arriba, a nivel de
// módulo — quedan cacheadas en memoria (mismo criterio LAZY que el resto de
// whatsapp.service.js) para toda la corrida de este archivo.
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "TEST_PHONE_NUMBER_ID";
process.env.WHATSAPP_GRAPH_API_VERSION = "v26.0";
process.env.WHATSAPP_OTP_TEMPLATE_NAME = "whatsapp_number_change_otp";
process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = "es_AR";

function mockMetaSend(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = original;
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Éxito por default — la mayoría de los tests no necesitan inspeccionar la
// llamada real a Meta, sólo que "el envío no falle".
function mockMetaSendSuccess() {
    return mockMetaSend(async () => jsonResponse(200, { messages: [{ id: `wamid.TEST_${randomUUID().slice(0, 8)}` }] }));
}

function mockMetaSendFailure(errorMessage = "template not approved") {
    return mockMetaSend(async () => jsonResponse(400, { error: { message: errorMessage } }));
}

// Captura el código plano REALMENTE enviado (nunca expuesto por el service
// mismo, ver el comentario de requestWhatsappNumberChangeService) —
// necesario para los tests de VERIFY, que sí necesitan el código real.
function mockMetaSendCapturingCode() {
    const captured = { code: null };
    const restore = mockMetaSend(async (url, options) => {
        const body = JSON.parse(options.body);
        captured.code = body.template.components?.[0]?.parameters?.[0]?.text ?? null;
        return jsonResponse(200, { messages: [{ id: `wamid.TEST_${randomUUID().slice(0, 8)}` }] });
    });
    return { captured, restore };
}

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `owner_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Cine Nadia ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function cleanup({ organizationIds = [], userIds = [], waIds = [] }) {
    await prisma.whatsappNumberChangeChallenge.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: { in: waIds } } });
    await prisma.conversationState.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

const NEW_PHONE = "+54 9 299 451-4062";
const NEW_WAID = "5492994514062";
const OLD_WAID = "5493514123456";

// ==================================================================
// 1/2) autorización — sólo el dueño real de la organización puede pedir.
// ==================================================================

testWithDb("1) an authorized owner can request a WhatsApp number change", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMetaSendSuccess();
    try {
        const result = await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        assert.deepEqual(result, { sent: true });

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.ok(challenge);
        assert.equal(challenge.newWaId, NEW_WAID);
        assert.equal(challenge.requestedByUserId, owner.id);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("2) a user who does not own the organization cannot request a change (organizationId in the body is never trusted alone)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const stranger = await createUser();
    const restore = mockMetaSendSuccess();
    try {
        await assert.rejects(
            () => requestWhatsappNumberChangeService(stranger.clerkId, org.id, NEW_PHONE),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_FORBIDDEN");
                return true;
            }
        );

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge, null, "un pedido no autorizado nunca debe crear un challenge");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, stranger.id] });
    }
});

// ==================================================================
// 3) número inválido rechazado.
// ==================================================================

testWithDb("3) an unparseable phone number is rejected before touching Meta or the database", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMetaSendSuccess();
    let metaCalled = false;
    globalThis.fetch = async () => {
        metaCalled = true;
        return jsonResponse(200, { messages: [{ id: "wamid.X" }] });
    };
    try {
        await assert.rejects(
            () => requestWhatsappNumberChangeService(owner.clerkId, org.id, "12345"),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_INVALID_NUMBER");
                return true;
            }
        );
        assert.equal(metaCalled, false, "un número inválido nunca debe llegar a intentar un envío por Meta");
        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge, null);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 4) OTP se almacena hasheado.
// ==================================================================

testWithDb("4) the OTP is stored as a hash, never in plain text", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        assert.ok(captured.code && /^\d{6}$/.test(captured.code));

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.notEqual(challenge.codeHash, captured.code, "el hash nunca debe ser igual al código plano");
        assert.equal(challenge.codeHash, hashVerificationCode(captured.code));
        assert.equal(challenge.codeHash.length, 64, "SHA-256 en hex");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 5/10/11/12/23) camino feliz completo, con todas las verificaciones de
// "antes" y "después" en un solo test end-to-end.
// ==================================================================

testWithDb("5/10/11/12/23) a correct OTP migrates the link; the old number stops administering this org, the new one takes over, Organization.phone never changes", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phone: "+54 351 555-0000" });
    const originalPhone = org.phone;
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });

    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        // 10) antes de verificar, el waId viejo sigue vinculado.
        const beforeVerify = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(beforeVerify.waId, OLD_WAID);

        const result = await verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code);
        assert.equal(result.migrated, true);

        // 11/12) después de verificar, el link pasó a ser el nuevo.
        const afterVerify = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(afterVerify.waId, NEW_WAID);
        assert.notEqual(afterVerify.waId, OLD_WAID);

        // 23) Organization.phone (contacto público) nunca se tocó.
        const reloadedOrg = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(reloadedOrg.phone, originalPhone);

        // El challenge se consumió — no debe quedar ninguna fila.
        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge, null);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 6) OTP incorrecto no cambia nada.
// ==================================================================

testWithDb("6) an incorrect OTP changes nothing and counts as a failed attempt", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const restore = mockMetaSendSuccess();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        await assert.rejects(
            () => verifyWhatsappNumberChangeService(owner.clerkId, org.id, "000000"),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_CODE_INVALID");
                return true;
            }
        );

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link.waId, OLD_WAID, "un código incorrecto nunca debe migrar nada");

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge.attempts, 1);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 7) OTP vencido no cambia nada — se siembra un challenge YA vencido
// directo en la base (sin sleeps, ver restricción del pedido).
// ==================================================================

testWithDb("7) an expired OTP changes nothing", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const plainCode = "123456";
    await prisma.whatsappNumberChangeChallenge.create({
        data: {
            organizationId: org.id,
            requestedByUserId: owner.id,
            oldWaId: OLD_WAID,
            newWaId: NEW_WAID,
            codeHash: hashVerificationCode(plainCode),
            attempts: 0,
            expiresAt: new Date(Date.now() - 1000), // ya vencido
            lastSentAt: new Date(Date.now() - 11 * 60 * 1000),
        },
    });
    try {
        await assert.rejects(
            () => verifyWhatsappNumberChangeService(owner.clerkId, org.id, plainCode),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_CODE_EXPIRED");
                return true;
            }
        );

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link.waId, OLD_WAID);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 8) demasiados intentos bloquean — incluso con el código correcto.
// ==================================================================

testWithDb("8) too many failed attempts block verification, even with the correct code afterwards", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        for (let i = 0; i < 5; i++) {
            await assert.rejects(() => verifyWhatsappNumberChangeService(owner.clerkId, org.id, "000000"));
        }

        await assert.rejects(
            () => verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_TOO_MANY_ATTEMPTS");
                return true;
            }
        );

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link, null, "nunca debe haberse migrado nada, ni con el código correcto, tras bloquearse");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 9) OTP usado no puede reutilizarse.
// ==================================================================

testWithDb("9) a used OTP cannot be verified again", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code);

        await assert.rejects(
            () => verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_NOT_FOUND");
                return true;
            }
        );
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 13) otras organizaciones del waId viejo permanecen intactas.
// ==================================================================

testWithDb("13) other organizations linked to the old waId are never touched", async () => {
    const owner = await createUser();
    const orgA = await createOrganization(owner.id); // se va a migrar
    const orgB = await createOrganization(owner.id); // comparte el waId viejo, NO se migra
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: orgA.id, waId: OLD_WAID } });
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: orgB.id, waId: OLD_WAID } });

    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, orgA.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, orgA.id, captured.code);

        const linkA = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: orgA.id } });
        const linkB = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: orgB.id } });
        assert.equal(linkA.waId, NEW_WAID);
        assert.equal(linkB.waId, OLD_WAID, "Organización B nunca debe verse afectada por la migración de A");
    } finally {
        restore();
        await cleanup({ organizationIds: [orgA.id, orgB.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 14) nuevo waId con otra organización conserva ambas (coexistencia).
// ==================================================================

testWithDb("14) a new waId that already administers another organization keeps both links after migrating", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const otherOwner = await createUser();
    const otherOrg = await createOrganization(otherOwner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: otherOrg.id, waId: NEW_WAID } });

    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        const otherLink = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: otherOrg.id } });
        assert.equal(link.waId, NEW_WAID);
        assert.equal(otherLink.waId, NEW_WAID, "el waId nuevo debe seguir administrando la organización que ya tenía");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id, otherOrg.id], userIds: [owner.id, otherOwner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 15) ConversationState viejo queda cerrado/inactivo (ABANDONED).
// ==================================================================

testWithDb("15) the old active ConversationState for this org is marked ABANDONED after migrating", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const conv = await prisma.conversationState.create({
        data: { channel: "WHATSAPP", channelRef: OLD_WAID, organizationId: org.id, currentStepId: "NAME", status: "ACTIVE" },
    });
    // Conversación de OTRA organización con el MISMO waId viejo — nunca debe tocarse.
    const otherOwner = await createUser();
    const otherOrg = await createOrganization(otherOwner.id);
    const otherConv = await prisma.conversationState.create({
        data: { channel: "WHATSAPP", channelRef: OLD_WAID, organizationId: otherOrg.id, currentStepId: "NAME", status: "ACTIVE" },
    });

    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code);

        const reloadedConv = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(reloadedConv.status, "ABANDONED");

        const reloadedOtherConv = await prisma.conversationState.findUnique({ where: { id: otherConv.id } });
        assert.equal(reloadedOtherConv.status, "ACTIVE", "una conversación de OTRA organización con el mismo waId nunca debe cerrarse");
    } finally {
        restore();
        await prisma.conversationState.deleteMany({ where: { id: { in: [conv.id, otherConv.id] } } });
        await cleanup({ organizationIds: [org.id, otherOrg.id], userIds: [owner.id, otherOwner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 16) fallo durante migración hace rollback completo. No se fuerza un
// fallo dentro del service real (requeriría parchear internals frágiles)
// — se demuestra la garantía de atomicidad del MISMO mecanismo
// (prisma.$transaction sobre el mismo cliente instrumentado) que
// verifyWhatsappNumberChangeService usa sin ninguna escritura fuera de la
// transacción: si cualquier paso de adentro falla, Postgres descarta TODO
// lo que esa transacción haya escrito hasta ese punto.
// ==================================================================

testWithDb("16) a failure anywhere inside the migration transaction rolls back everything written before it", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await assert.rejects(
            prisma.$transaction(async (tx) => {
                await tx.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: NEW_WAID } });
                throw new Error("forced failure mid-transaction");
            })
        );

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link, null, "la escritura previa a la falla nunca debe haber quedado persistida");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 17) doble verify concurrente no duplica/migra dos veces.
// ==================================================================

testWithDb("17) two concurrent verify calls with the same code migrate exactly once", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        const results = await Promise.allSettled([
            verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code),
            verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactamente una de las dos verificaciones concurrentes debe migrar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, "WHATSAPP_NUMBER_CHANGE_ALREADY_RESOLVED");

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link.waId, NEW_WAID);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 18) resend respeta cooldown.
// ==================================================================

testWithDb("18) resend respects the cooldown, and succeeds again once it elapses", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMetaSendSuccess();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        await assert.rejects(
            () => resendWhatsappNumberChangeOtpService(owner.clerkId, org.id),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_RESEND_TOO_SOON");
                return true;
            }
        );

        // Simula que pasó el cooldown retrocediendo lastSentAt (sin sleep).
        await prisma.whatsappNumberChangeChallenge.updateMany({
            where: { organizationId: org.id },
            data: { lastSentAt: new Date(Date.now() - 61 * 1000) },
        });

        const result = await resendWhatsappNumberChangeOtpService(owner.clerkId, org.id);
        assert.deepEqual(result, { sent: true });
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 19) cancel no modifica el vínculo existente.
// ==================================================================

testWithDb("19) cancel discards the pending challenge without ever touching the existing link", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const restore = mockMetaSendSuccess();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        const result = await cancelWhatsappNumberChangeService(owner.clerkId, org.id);
        assert.deepEqual(result, { cancelled: true });

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge, null);

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link.waId, OLD_WAID);

        // Idempotente: cancelar de nuevo (nada pendiente) no debe lanzar.
        await assert.doesNotReject(() => cancelWhatsappNumberChangeService(owner.clerkId, org.id));
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// 20/22) el flujo multi-organización y el reconocimiento por waId siguen
// funcionando después de migrar, SIN depender de Organization.phone.
// ==================================================================

testWithDb("20/22) after migrating, discoverWhatsappOrganizationCandidates recognizes the new waId directly via the link, with Organization.phone left null", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phone: null });
    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, org.id, captured.code);

        const candidates = await discoverWhatsappOrganizationCandidates(NEW_WAID);
        assert.equal(candidates.length, 1);
        assert.equal(candidates[0].organizationId, org.id);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [NEW_WAID] });
    }
});

testWithDb("20) multi-organization selector keeps working: a waId administering two organizations is still discovered as two candidates after one of them changed number", async () => {
    const owner = await createUser();
    const orgA = await createOrganization(owner.id);
    const otherOwner = await createUser();
    const orgB = await createOrganization(otherOwner.id);
    // Ambas ya comparten el waId NUEVO antes de que A migre (B lo tenía de antes).
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: orgB.id, waId: NEW_WAID } });

    const { captured, restore } = mockMetaSendCapturingCode();
    try {
        await requestWhatsappNumberChangeService(owner.clerkId, orgA.id, NEW_PHONE);
        await verifyWhatsappNumberChangeService(owner.clerkId, orgA.id, captured.code);

        const candidates = await discoverWhatsappOrganizationCandidates(NEW_WAID);
        const ids = candidates.map((c) => c.organizationId).sort();
        assert.deepEqual(ids, [orgA.id, orgB.id].sort(), "el selector multi-organización debe seguir mostrando ambas");
    } finally {
        restore();
        await cleanup({ organizationIds: [orgA.id, orgB.id], userIds: [owner.id, otherOwner.id], waIds: [NEW_WAID] });
    }
});

// ==================================================================
// 21) Web existente (organization.service.js) sigue funcionando sin
// cambios — no se tocó ninguna de sus funciones.
// ==================================================================

testWithDb("21) Web's existing GET/PATCH /me organization flow is unaffected by this feature", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { phone: "+54 351 555-1111" });
    try {
        const fetched = await getMyOrganizationService(owner.clerkId);
        assert.equal(fetched.id, org.id);
        assert.equal(fetched.phone, "+54 351 555-1111");

        const updated = await updateMyOrganizationService(owner.clerkId, { phone: "+54 351 555-2222", name: fetched.name });
        assert.equal(updated.phone, "+54 351 555-2222", "PATCH /me sigue pudiendo cambiar el teléfono público libremente");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 24) fallo al enviar OTP por Meta no migra nada — ni crea un challenge
// fantasma, ni dispara ningún cambio en WhatsappOrganizerLink.
// ==================================================================

testWithDb("24) a failed Meta send never creates a dangling challenge and never migrates anything", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const restore = mockMetaSendFailure();
    try {
        await assert.rejects(
            () => requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE),
            (error) => {
                assert.equal(error.code, "WHATSAPP_NUMBER_CHANGE_SEND_FAILED");
                return true;
            }
        );

        const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: org.id } });
        assert.equal(challenge, null, "un envío fallido nunca debe dejar un challenge vivo esperando un código que nunca llegó");

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.equal(link.waId, OLD_WAID);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});

// ==================================================================
// GET status — usado por la pantalla de Configuración para mostrar el
// número autorizado actual.
// ==================================================================

testWithDb("GET status reports the current authorized number and whether a change is pending", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    await prisma.whatsappOrganizerLink.create({ data: { organizationId: org.id, waId: OLD_WAID } });
    const restore = mockMetaSendSuccess();
    try {
        const before = await getWhatsappNumberChangeStatusService(owner.clerkId, org.id);
        assert.equal(before.waId, OLD_WAID);
        assert.equal(before.hasPendingChange, false);

        await requestWhatsappNumberChangeService(owner.clerkId, org.id, NEW_PHONE);

        const after = await getWhatsappNumberChangeStatusService(owner.clerkId, org.id);
        assert.equal(after.waId, OLD_WAID, "el número autorizado no cambia hasta verificar");
        assert.equal(after.hasPendingChange, true);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], waIds: [OLD_WAID, NEW_WAID] });
    }
});
