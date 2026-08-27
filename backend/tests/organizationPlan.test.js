import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { updateOrganizationPlanService } from "../src/services/organization.service.js";
import {
    getMyOrganization,
    updateMyOrganization,
    updateOrganizationPlan,
} from "../src/controllers/organization.controller.js";
import { requireRole } from "../src/middlewares/requireRole.js";
import { setPublicLaunchEnabledService } from "../src/services/publicLaunchSettings.service.js";

// Premium — Fase 1 (infraestructura + administración manual, ver el
// informe de auditoría/entrega). CRUD + guards reales contra Postgres real
// (backend/.env.test), mismo criterio/helpers que
// developerAlertConfig.crud.test.js y publicLaunchSettings.test.js.
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function fakeRes() {
    const state = {};
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(body) {
            state.jsonBody = body;
            return res;
        },
    };
    return { res, state };
}

function fakeReqWithAuth(clerkId, extra = {}) {
    const req = { headers: {}, body: {}, params: {}, ...extra };
    req.auth = Object.assign(() => ({ userId: clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

// ==================================================================
// A/B) Default — cualquier Organization sin `plan` explícito (nueva, o
// conceptualmente "migrada" — el mecanismo es el mismo @default(FREE) de
// la migración, no hay backfill que probar por separado) queda FREE.
// ==================================================================

testWithDb("A/B) Organization nueva sin plan explícito queda FREE por default", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        assert.equal(org.plan, "FREE");
        assert.equal(org.planUpdatedAt, null);
        assert.equal(org.planUpdatedByUserId, null);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// C/D) DEVELOPER cambia el plan en ambas direcciones.
// ==================================================================

testWithDb("C) DEVELOPER cambia FREE -> PREMIUM vía el controller, y persiste planUpdatedAt/planUpdatedByUserId", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id);
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { plan: "PREMIUM" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationPlan(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.plan, "PREMIUM");
        assert.ok(state.jsonBody.organization.planUpdatedAt);
        assert.equal(state.jsonBody.organization.planUpdatedByUserId, developer.id);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("D) DEVELOPER cambia PREMIUM -> FREE vía el controller", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { plan: "FREE" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationPlan(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.plan, "FREE");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// ==================================================================
// E/F) Permisos — ORGANIZER 403, sin sesión 401. Mismo mecanismo genérico
// requireRole("DEVELOPER") ya probado en developerAlertConfig/PublicLaunch
// — se prueba acá aplicado a esta ruta puntual.
// ==================================================================

testWithDb("E) un ORGANIZER no puede cambiar el plan — requireRole('DEVELOPER') lo bloquea con 403", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = fakeReqWithAuth(organizer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [organizer.id] });
    }
});

testWithDb("F) sin sesión (usuario no autenticado) recibe 401", async () => {
    const req = fakeReqWithAuth(null);
    const { res, state } = fakeRes();
    let nextCalled = false;
    await requireRole("DEVELOPER")(req, res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(state.statusCode, 401);
});

// ==================================================================
// G/H) Validación de input y de existencia.
// ==================================================================

testWithDb("G) plan inválido -> 400, mismo patrón que 'Estado inválido'", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id);
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { plan: "GOLD" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationPlan(req, res);

        assert.equal(state.statusCode, 400);
        const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(fresh.plan, "FREE", "un plan inválido nunca debe tocar la fila");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("H) Organization inexistente -> 404, mismo patrón que updateOrganizationStatus", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: "org-que-no-existe" }, body: { plan: "PREMIUM" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationPlan(req, res);

        assert.equal(state.statusCode, 404);
    } finally {
        await cleanup({ userIds: [developer.id] });
    }
});

// ==================================================================
// I) Organizer lee correctamente su plan por GET /api/organizations/me —
// sin ningún endpoint nuevo, mismo controller de siempre.
// ==================================================================

testWithDb("I) GET /api/organizations/me devuelve plan=PREMIUM correctamente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    try {
        const req = fakeReqWithAuth(owner.clerkId);
        const { res, state } = fakeRes();
        await getMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.plan, "PREMIUM");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// J/K) El Organizer NO puede modificar su plan ni la trazabilidad vía el
// PATCH self-service — porque esos 3 campos deliberadamente nunca están
// en UPDATABLE_FIELDS (mismo mecanismo que ya protege `phone`).
// ==================================================================

testWithDb("J) PATCH /organizations/me con plan:'PREMIUM' en el body NO modifica el plan real", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, plan: "PREMIUM" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.plan, "FREE", "plan enviado en el body debe ser ignorado en silencio, igual que cualquier campo fuera de UPDATABLE_FIELDS");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("K) PATCH /organizations/me intentando modificar planUpdatedAt/planUpdatedByUserId tampoco los modifica", async () => {
    const owner = await createUser();
    const attacker = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id, { plan: "PREMIUM", planUpdatedByUserId: attacker.id, planUpdatedAt: new Date("2020-01-01") });
    try {
        const req = fakeReqWithAuth(owner.clerkId, {
            body: { name: org.name, planUpdatedAt: new Date().toISOString(), planUpdatedByUserId: owner.id },
        });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(new Date(state.jsonBody.organization.planUpdatedAt).toISOString(), new Date("2020-01-01").toISOString());
        assert.equal(state.jsonBody.organization.planUpdatedByUserId, attacker.id);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, attacker.id] });
    }
});

// ==================================================================
// L) Cambiar el plan no toca ningún otro dato de la Organization.
// ==================================================================

testWithDb("L) cambiar el plan NO modifica status/approvedAt/approvedBy/ownerId", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const approvedAt = new Date("2024-05-01");
    const org = await createOrganization(owner.id, { status: "APPROVED", approvedAt, approvedBy: developer.id });
    try {
        const updated = await updateOrganizationPlanService(org.id, "PREMIUM", developer.id);

        assert.equal(updated.status, "APPROVED");
        assert.equal(updated.approvedAt.toISOString(), approvedAt.toISOString());
        assert.equal(updated.approvedBy, developer.id);
        assert.equal(updated.ownerId, owner.id);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// ==================================================================
// M) publicLaunchEnabled=false NO impide que DEVELOPER cambie el plan —
// conceptos completamente independientes (ver el informe de auditoría).
// ==================================================================

testWithDb("M) publicLaunchEnabled=false no impide que DEVELOPER cambie el plan", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id);
    const beforeLaunchSettings = await prisma.publicLaunchSettings.findFirst({ orderBy: { createdAt: "asc" } });
    try {
        await setPublicLaunchEnabledService(null, false);

        const updated = await updateOrganizationPlanService(org.id, "PREMIUM", developer.id);
        assert.equal(updated.plan, "PREMIUM");
    } finally {
        if (beforeLaunchSettings) {
            await prisma.publicLaunchSettings.update({
                where: { id: beforeLaunchSettings.id },
                data: { publicLaunchEnabled: beforeLaunchSettings.publicLaunchEnabled, updatedByUserId: beforeLaunchSettings.updatedByUserId },
            });
        }
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// N) FREE_ENTRY continúa funcionando sin cambios — a propósito NO se
// duplica un test acá: se re-ejecuta un test focalizado ya existente
// (backend/tests/eventAdmissionType.test.js) como parte de esta ronda,
// ver el informe de entrega.
