import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    updateMyOrganization,
    updateOrganizationCategory,
} from "../src/controllers/organization.controller.js";

// Rubro de contenido (Organization.organizationCategory) dejó de ser
// exclusivo de Developer: el propio Organizer ahora puede leerlo/editarlo
// desde su panel vía PATCH /api/organizations/me (updateMyOrganization,
// el mismo endpoint que ya persistía nombre/ciudad/etc — ver
// organization.service.js#UPDATABLE_FIELDS). Developer sigue pudiendo
// editarlo vía PATCH /api/organizations/:id/category
// (updateOrganizationCategory), sin cambios. Ambos escriben el MISMO campo
// de la MISMA tabla — nunca dos fuentes de verdad. CRUD + guards reales
// contra Postgres real (backend/.env.test), mismo criterio/helpers que
// organizationPlan.test.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `user_${suffix}@example.com`,
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
            name: `Sala ${suffix}`,
            slug: `sala-${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    const cleanOrgIds = organizationIds.filter(Boolean);
    const cleanUserIds = userIds.filter(Boolean);
    if (cleanOrgIds.length) await prisma.organization.deleteMany({ where: { id: { in: cleanOrgIds } } });
    if (cleanUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanUserIds } } });
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

testWithDb("CAT-A: el Organizer puede actualizar su propio organizationCategory vía PATCH /organizations/me", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { organizationCategory: null });
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "MUSIC" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.organizationCategory, "MUSIC");

        const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(fresh.organizationCategory, "MUSIC");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("CAT-B: Developer sigue pudiendo actualizar el mismo campo vía PATCH /organizations/:id/category", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id, { organizationCategory: null });
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { category: "SPORTS" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationCategory(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.organizationCategory, "SPORTS");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CAT-C: un valor válido persiste exactamente igual sea escrito por Organizer o por Developer", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id, { organizationCategory: null });
    try {
        const reqOrganizer = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "THEATER" } });
        const { res: resOrganizer, state: stateOrganizer } = fakeRes();
        await updateMyOrganization(reqOrganizer, resOrganizer);
        assert.equal(stateOrganizer.jsonBody.organization.organizationCategory, "THEATER");

        const reqDeveloper = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { category: "CINEMA" } });
        reqDeveloper.dbUser = developer;
        const { res: resDeveloper, state: stateDeveloper } = fakeRes();
        await updateOrganizationCategory(reqDeveloper, resDeveloper);
        assert.equal(stateDeveloper.jsonBody.organization.organizationCategory, "CINEMA");

        const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(fresh.organizationCategory, "CINEMA", "misma fila, mismo campo — el último write gana");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CAT-D: un valor inválido se rechaza con 400 y no toca la fila", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { organizationCategory: null });
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "GOLD" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 400);
        assert.equal(state.jsonBody.message, "Rubro inválido");

        const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(fresh.organizationCategory, null, "un rubro inválido nunca debe tocar la fila");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("CAT-D2: Developer también recibe 400 ante un rubro inválido, mismo patrón que updateOrganizationPlan", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const org = await createOrganization(owner.id, { organizationCategory: "MUSIC" });
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { id: org.id }, body: { category: "GOLD" } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateOrganizationCategory(req, res);

        assert.equal(state.statusCode, 400);
        const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(fresh.organizationCategory, "MUSIC", "un rubro inválido nunca debe tocar la fila existente");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("CAT-E: una organización histórica con organizationCategory null puede completarlo sin problema", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { organizationCategory: null });
    try {
        const before = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(before.organizationCategory, null);

        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "PRODUCER" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.organizationCategory, "PRODUCER");
        assert.equal(state.jsonBody.organization.status, "APPROVED", "no debe bloquear ni alterar el status");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("CAT-F: cambiar el rubro no modifica plan/status/ranking de la organización", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, {
        organizationCategory: null,
        plan: "PREMIUM",
        status: "APPROVED",
    });
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "OTHER" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.plan, "PREMIUM");
        assert.equal(state.jsonBody.organization.status, "APPROVED");
        assert.equal(state.jsonBody.organization.organizationCategory, "OTHER");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("CAT-G: un valor vacío ('') se persiste como null (vuelve a 'sin rubro'), no como string vacío", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { organizationCategory: "MUSIC" });
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { name: org.name, organizationCategory: "" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.organizationCategory, null);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("CAT-H: si el body no trae la clave organizationCategory, el valor existente no se toca", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { organizationCategory: "SPORTS" });
    try {
        const req = fakeReqWithAuth(owner.clerkId, { body: { city: "Rosario" } });
        const { res, state } = fakeRes();
        await updateMyOrganization(req, res);

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.organization.organizationCategory, "SPORTS");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});
