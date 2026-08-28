import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    getAllPlanLimitsForDeveloperService,
    updatePlanLimitsService,
    getPlanLimits,
    getOrganizationPlanLimits,
    isPremium,
    isFeatureAvailable,
    getLimitForOrganization,
    PremiumFeature,
    PlanLimitKey,
} from "../src/services/organizationPlanPolicy.js";
import { getDeveloperPlanLimits, updateDeveloperPlanLimits } from "../src/controllers/developerPlanLimits.controller.js";
import { requireRole } from "../src/middlewares/requireRole.js";

// Premium — Fase 2A. CRUD real contra Postgres real (backend/.env.test),
// mismo criterio/helpers que developerAlertConfig.crud.test.js. Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
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

async function cleanupUsers(userIds) {
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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

async function snapshotPlanLimits() {
    const [free, premium] = await Promise.all([
        prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } }),
        prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } }),
    ]);
    return { FREE: free, PREMIUM: premium };
}

// Restaura EXACTAMENTE los valores originales (incluido updatedByUserId) —
// si la fila fue borrada durante el test (PS-L), la recrea; nunca deja el
// singleton en un estado distinto al que tenía antes de este archivo.
async function restorePlanLimits(snapshot) {
    for (const plan of ["FREE", "PREMIUM"]) {
        const original = snapshot[plan];
        if (!original) continue;
        const current = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
        const data = {
            maxActiveEvents: original.maxActiveEvents,
            maxCourtesiesPerEvent: original.maxCourtesiesPerEvent,
            maxScannersPerEvent: original.maxScannersPerEvent,
            updatedByUserId: original.updatedByUserId,
        };
        if (current) {
            await prisma.organizationPlanLimits.update({ where: { plan }, data });
        } else {
            await prisma.organizationPlanLimits.create({ data: { plan, ...data } });
        }
    }
}

testWithDb("PS-A: DEVELOPER puede leer los límites de FREE y PREMIUM", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        const { res, state } = fakeRes();
        await getDeveloperPlanLimits(req, res, () => {});

        assert.equal(state.statusCode, 200);
        assert.ok(state.jsonBody.FREE);
        assert.ok(state.jsonBody.PREMIUM);
        assert.equal(state.jsonBody.FREE.plan, "FREE");
        assert.equal(state.jsonBody.PREMIUM.plan, "PREMIUM");
    } finally {
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-B: un ORGANIZER no puede modificar los límites — requireRole('DEVELOPER') lo bloquea con 403", async () => {
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
        await cleanupUsers([organizer.id]);
    }
});

testWithDb("PS-C: un CUSTOMER no puede modificar los límites — requireRole('DEVELOPER') lo bloquea con 403", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    try {
        const req = fakeReqWithAuth(customer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanupUsers([customer.id]);
    }
});

testWithDb("PS-D: DEVELOPER puede cambiar maxActiveEvents de FREE vía el controller", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        const req = fakeReqWithAuth(developer.clerkId, { params: { plan: "FREE" }, body: { maxActiveEvents: 5 } });
        req.dbUser = developer;
        const { res, state } = fakeRes();
        await updateDeveloperPlanLimits(req, res, () => {});

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.maxActiveEvents, 5);

        const fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        assert.equal(fresh.maxActiveEvents, 5);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-E: DEVELOPER puede volver a establecer null = sin límite", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxScannersPerEvent: 20 });
        const withLimit = await prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } });
        assert.equal(withLimit.maxScannersPerEvent, 20);

        const updated = await updatePlanLimitsService("PREMIUM", developer.id, { maxScannersPerEvent: null });
        assert.equal(updated.maxScannersPerEvent, null);

        const fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } });
        assert.equal(fresh.maxScannersPerEvent, null);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-F: 0 se persiste correctamente y NO se convierte en null/falsy", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        const updated = await updatePlanLimitsService("FREE", developer.id, { maxCourtesiesPerEvent: 0 });
        assert.equal(updated.maxCourtesiesPerEvent, 0);
        assert.notEqual(updated.maxCourtesiesPerEvent, null);

        const fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        assert.equal(fresh.maxCourtesiesPerEvent, 0);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-G: un valor negativo es rechazado y la fila queda intacta", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await assert.rejects(
            () => updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: -1 }),
            (error) => {
                assert.equal(error.code, "PLAN_LIMITS_INVALID");
                assert.ok(Array.isArray(error.details) && error.details.length > 0);
                return true;
            }
        );
        const fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        assert.equal(fresh.maxActiveEvents, snapshot.FREE?.maxActiveEvents ?? null);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-H: un valor float es rechazado y la fila queda intacta", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await assert.rejects(
            () => updatePlanLimitsService("PREMIUM", developer.id, { maxScannersPerEvent: 2.5 }),
            (error) => {
                assert.equal(error.code, "PLAN_LIMITS_INVALID");
                return true;
            }
        );
        const fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } });
        assert.equal(fresh.maxScannersPerEvent, snapshot.PREMIUM?.maxScannersPerEvent ?? null);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-I: actualizar límites no modifica ninguna Organization existente", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const owner = await createUser({ role: "ORGANIZER" });
    const suffix = uniqueSuffix();
    const snapshot = await snapshotPlanLimits();
    let org;
    try {
        org = await prisma.organization.create({
            data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, ownerId: owner.id, plan: "FREE" },
        });
        const before = await prisma.organization.findUnique({ where: { id: org.id } });

        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 1, maxCourtesiesPerEvent: 1, maxScannersPerEvent: 1 });

        const after = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.deepEqual(after, before, "ninguna columna de la Organization debe cambiar");
    } finally {
        await restorePlanLimits(snapshot);
        if (org) await prisma.organization.delete({ where: { id: org.id } });
        await cleanupUsers([developer.id, owner.id]);
    }
});

testWithDb("PS-J: updatedByUserId queda asociado al DEVELOPER que hizo el cambio", async () => {
    const developerA = await createUser({ role: "DEVELOPER" });
    const developerB = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await updatePlanLimitsService("FREE", developerA.id, { maxActiveEvents: 3 });
        let fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        assert.equal(fresh.updatedByUserId, developerA.id);

        await updatePlanLimitsService("FREE", developerB.id, { maxActiveEvents: 7 });
        fresh = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        assert.equal(fresh.updatedByUserId, developerB.id);
        assert.equal(fresh.maxActiveEvents, 7);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developerA.id, developerB.id]);
    }
});

testWithDb("PS-K: FREE y PREMIUM son configuraciones completamente independientes", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxActiveEvents: 3 });
        await updatePlanLimitsService("PREMIUM", developer.id, { maxActiveEvents: null });

        const free = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });
        const premium = await prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } });
        assert.equal(free.maxActiveEvents, 3);
        assert.equal(premium.maxActiveEvents, null);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanupUsers([developer.id]);
    }
});

testWithDb("PS-L: si falta la fila de un plan, la policy cae al fallback sin límite (nunca bloquea, nunca lanza)", async () => {
    const snapshot = await snapshotPlanLimits();
    try {
        await prisma.organizationPlanLimits.delete({ where: { plan: "PREMIUM" } });

        const limits = await getPlanLimits("PREMIUM");
        assert.equal(limits.maxActiveEvents, null);
        assert.equal(limits.maxCourtesiesPerEvent, null);
        assert.equal(limits.maxScannersPerEvent, null);

        const forOrg = await getOrganizationPlanLimits({ plan: "PREMIUM" });
        assert.equal(forOrg.maxScannersPerEvent, null);

        const single = await getLimitForOrganization({ plan: "PREMIUM" }, PlanLimitKey.ACTIVE_EVENTS);
        assert.equal(single, null);

        // El panel Developer, en cambio, SÍ debe enterarse (500 explícito)
        // — ver getAllPlanLimitsForDeveloperService.
        await assert.rejects(() => getAllPlanLimitsForDeveloperService(), (error) => {
            assert.equal(error.code, "PLAN_LIMITS_MISSING");
            return true;
        });
    } finally {
        await restorePlanLimits(snapshot);
    }
});

test("isPremium / isFeatureAvailable: no dependen de la base, sólo del objeto Organization recibido", () => {
    assert.equal(isPremium({ plan: "PREMIUM" }), true);
    assert.equal(isPremium({ plan: "FREE" }), false);
    assert.equal(isPremium(null), false);
    assert.equal(isPremium(undefined), false);

    assert.equal(isFeatureAvailable({ plan: "PREMIUM" }, PremiumFeature.WHATSAPP_EVENT_CREATION), true);
    assert.equal(isFeatureAvailable({ plan: "FREE" }, PremiumFeature.PUBLIC_ORGANIZATION_PAGE), false);
    assert.throws(() => isFeatureAvailable({ plan: "PREMIUM" }, "NOT_A_REAL_FEATURE"));
});
