import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createOrganizationService, updateMyOrganizationService, updateOrganizationPlanService } from "../src/services/organization.service.js";

// Premium — Fase 2A. CRUD real contra Postgres real (backend/.env.test),
// mismo criterio/helpers que organizationPlan.test.js. Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "CUSTOMER", ...overrides },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    if (organizationIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

testWithDb("SLUG-A: una Organization nueva recibe slug al crearse vía createOrganizationService", async () => {
    const owner = await createUser();
    const suffix = uniqueSuffix();
    let org;
    try {
        const { organization } = await createOrganizationService(owner.clerkId, {
            name: `Teatro ${suffix}`,
            email: `teatro_${suffix}@example.com`,
        });
        org = organization;

        assert.ok(org.slug, "debe tener slug no vacío");
        assert.match(org.slug, /^teatro-/);
        assert.equal(org.plan, "FREE", "default FREE, slug no depende del plan");

        const bySlug = await prisma.organization.findUnique({ where: { slug: org.slug } });
        assert.equal(bySlug?.id, org.id);
    } finally {
        await cleanup({ organizationIds: org ? [org.id] : [], userIds: [owner.id] });
    }
});

testWithDb("SLUG-C: dos Organizations con el mismo nombre reciben slugs distintos", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const suffix = uniqueSuffix();
    const sharedName = `Sala Compartida ${suffix}`;
    let orgA, orgB;
    try {
        orgA = (await createOrganizationService(ownerA.clerkId, { name: sharedName, email: `a_${suffix}@example.com` })).organization;
        orgB = (await createOrganizationService(ownerB.clerkId, { name: sharedName, email: `b_${suffix}@example.com` })).organization;

        assert.notEqual(orgA.slug, orgB.slug, "el mismo nombre nunca debe producir el mismo slug para dos Organizations distintas");
        assert.match(orgA.slug, /^sala-compartida-/);
        assert.match(orgB.slug, /^sala-compartida-/);
    } finally {
        await cleanup({ organizationIds: [orgA?.id, orgB?.id].filter(Boolean), userIds: [ownerA.id, ownerB.id] });
    }
});

testWithDb("SLUG-D: cambiar Organization.name NO cambia el slug (self-service PATCH /me)", async () => {
    const owner = await createUser();
    const suffix = uniqueSuffix();
    let org;
    try {
        org = (await createOrganizationService(owner.clerkId, { name: `Original ${suffix}`, email: `orig_${suffix}@example.com` })).organization;
        const originalSlug = org.slug;

        const updated = await updateMyOrganizationService(owner.clerkId, { name: `Nombre Completamente Distinto ${suffix}` });

        assert.equal(updated.name, `Nombre Completamente Distinto ${suffix}`);
        assert.equal(updated.slug, originalSlug, "slug debe quedar exactamente igual pese a cambiar el nombre");
    } finally {
        await cleanup({ organizationIds: org ? [org.id] : [], userIds: [owner.id] });
    }
});

testWithDb("SLUG-E: cambiar el plan FREE->PREMIUM->FREE no toca el slug", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    const suffix = uniqueSuffix();
    let org;
    try {
        org = (await createOrganizationService(owner.clerkId, { name: `Sala Plan ${suffix}`, email: `plan_${suffix}@example.com` })).organization;
        const originalSlug = org.slug;

        const toPremium = await updateOrganizationPlanService(org.id, "PREMIUM", developer.id);
        assert.equal(toPremium.slug, originalSlug);

        const backToFree = await updateOrganizationPlanService(org.id, "FREE", developer.id);
        assert.equal(backToFree.slug, originalSlug);
    } finally {
        await cleanup({ organizationIds: org ? [org.id] : [], userIds: [owner.id, developer.id] });
    }
});

testWithDb("REGRESIÓN: crear una Organization directo vía Prisma sin slug sigue funcionando (columna nullable a propósito, ver SLUG-F manual)", async () => {
    const owner = await createUser();
    const suffix = uniqueSuffix();
    let org;
    try {
        // Mismo patrón que usan hoy 16 archivos de test + 1 script
        // (prisma.organization.create sin pasar por el service) — ver el
        // informe de entrega, sección "premisa incorrecta detectada". Este
        // test fija que ese patrón sigue funcionando sin romperse.
        org = await prisma.organization.create({
            data: { name: `Fixture ${suffix}`, email: `fixture_${suffix}@example.com`, ownerId: owner.id },
        });
        assert.equal(org.slug, null);
    } finally {
        await cleanup({ organizationIds: org ? [org.id] : [], userIds: [owner.id] });
    }
});
