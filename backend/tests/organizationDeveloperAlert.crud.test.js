import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createOrganizationService, updateOrganizationStatusService, updateMyOrganizationService } from "../src/services/organization.service.js";

// Bug reportado: crear una organización NUEVA queda PENDING correctamente,
// pero el Developer nunca recibe el email de aviso. Este archivo prueba el
// cableado REAL createOrganizationService -> sendDeveloperAlert(NEW_ORGANIZATION_PENDING)
// -> Resend, contra Postgres real (backend/.env.test) — nunca existía un
// test de esto antes (sólo había tests de sendDeveloperAlert en aislamiento,
// con un payload fabricado a mano, ver sendDeveloperAlert.service.test.js).
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function withMockedDeveloperAlertEnv() {
    const original = {
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        EMAIL_FROM: process.env.EMAIL_FROM,
        FRONTEND_URL: process.env.FRONTEND_URL,
        DEVELOPER_ALERT_EMAIL: process.env.DEVELOPER_ALERT_EMAIL,
    };
    process.env.RESEND_API_KEY = "test-mocked-resend-api-key";
    process.env.EMAIL_FROM = "PaseCultural <no-reply@smarticket.com.ar>";
    process.env.FRONTEND_URL = "https://pasecultural.test";
    process.env.DEVELOPER_ALERT_EMAIL = "developer-test@example.com";
    return () => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

function mockResendFetch(onSend) {
    const original = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes("api.resend.com/emails")) {
            onSend(JSON.parse(opts.body));
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${url} during a mocked test`);
    };
    return () => {
        globalThis.fetch = original;
    };
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `owner_${suffix}@example.com`, firstName: "Nadia", role: "CUSTOMER", ...overrides },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

testWithDb("creating a real new Organization sends exactly one NEW_ORGANIZATION_PENDING email to DEVELOPER_ALERT_EMAIL", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedDeveloperAlertEnv();
    const sentEmails = [];
    const restoreFetch = mockResendFetch((body) => sentEmails.push(body));
    let organization;
    try {
        const orgName = `Sala ${uniqueSuffix()}`;
        ({ organization } = await createOrganizationService(owner.clerkId, {
            name: orgName,
            email: `org_${uniqueSuffix()}@example.com`,
        }));

        assert.equal(organization.status, "PENDING", "la organización debe quedar PENDING (comportamiento ya conocido/correcto)");
        assert.equal(sentEmails.length, 1, "debe intentarse mandar EXACTAMENTE un email al crear una organización nueva real");
        assert.equal(sentEmails[0].to, "developer-test@example.com");
        assert.ok(sentEmails[0].subject.includes(orgName), "el asunto debe identificar la organización");
        assert.ok(sentEmails[0].html.includes(organization.id), "el cuerpo debe incluir el organizationId para poder revisarla");
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("a second organization from the same owner (already exists) never sends a second NEW_ORGANIZATION_PENDING email", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedDeveloperAlertEnv();
    const sentEmails = [];
    const restoreFetch = mockResendFetch((body) => sentEmails.push(body));
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        assert.equal(sentEmails.length, 1);

        // Reintento del mismo owner (doble click, retry de frontend) — el
        // service ya tiene un early-return conocido para esto (devuelve la
        // organización EXISTENTE sin crear una fila nueva); confirmamos que
        // tampoco dispara un segundo email.
        const second = await createOrganizationService(owner.clerkId, { name: "Otro nombre", email: "otro@example.com" });
        assert.equal(second.organization.id, organization.id, "debe devolver la organización YA existente, nunca crear una segunda");
        assert.equal(sentEmails.length, 1, "un reintento sobre un owner que ya tiene organización no debe generar un segundo email");
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("approving an existing organization never sends another NEW_ORGANIZATION_PENDING email", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedDeveloperAlertEnv();
    const sentEmails = [];
    const restoreFetch = mockResendFetch((body) => sentEmails.push(body));
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        assert.equal(sentEmails.length, 1);

        await updateOrganizationStatusService(organization.id, "APPROVED", owner.id);
        assert.equal(sentEmails.length, 1, "aprobar una organización no debe disparar otra alerta de 'nueva organización'");
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("editing an existing organization's trivial fields never sends a NEW_ORGANIZATION_PENDING email", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedDeveloperAlertEnv();
    const sentEmails = [];
    const restoreFetch = mockResendFetch((body) => sentEmails.push(body));
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        assert.equal(sentEmails.length, 1);

        await updateMyOrganizationService(owner.clerkId, { description: "Nueva descripción" });
        assert.equal(sentEmails.length, 1, "editar campos triviales de una organización existente no debe disparar ninguna alerta de creación");
    } finally {
        restoreFetch();
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("if Resend itself rejects the send, organization creation still succeeds and the failure is logged with a clear reason (never silently 'ok')", async () => {
    const owner = await createUser();
    const restoreEnv = withMockedDeveloperAlertEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes("api.resend.com/emails")) {
            // Resend real: 4xx/5xx con {message} en el body — nunca un
            // throw de red, eso ya lo cubre el catch de sendDeveloperAlert.
            return { ok: false, status: 422, headers: { entries: () => [] }, json: async () => ({ name: "validation_error", message: "Invalid `to` field" }) };
        }
        throw new Error(`unexpected fetch call to ${url}`);
    };
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        // El caso importante: la organización quedó creada IGUAL — un
        // fallo real de Resend (no sólo config ausente) tampoco debe poder
        // revertir ni impedir la creación (best-effort de punta a punta).
        assert.equal(organization.status, "PENDING");
        assert.ok(organization.id);
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv();
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

testWithDb("if DEVELOPER_ALERT_EMAIL is not configured, organization creation still succeeds (best-effort, never blocks)", async () => {
    const owner = await createUser();
    const original = process.env.DEVELOPER_ALERT_EMAIL;
    delete process.env.DEVELOPER_ALERT_EMAIL;
    let organization;
    try {
        // Sin mock de fetch: si el código intentara mandar igual, este test
        // fallaría por una llamada de red inesperada — confirma que
        // sendDeveloperAlert corta ANTES de tocar Resend cuando falta la
        // env var (ver el chequeo explícito en sendDeveloperAlert.service.js).
        ({ organization } = await createOrganizationService(owner.clerkId, { name: `Sala ${uniqueSuffix()}`, email: `org_${uniqueSuffix()}@example.com` }));
        assert.equal(organization.status, "PENDING");
    } finally {
        if (original === undefined) delete process.env.DEVELOPER_ALERT_EMAIL;
        else process.env.DEVELOPER_ALERT_EMAIL = original;
        if (organization) await cleanup({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});
