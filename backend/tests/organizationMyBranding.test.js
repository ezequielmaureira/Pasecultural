import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getMyOrganizationService } from "../src/services/organization.service.js";
import { isFeatureAvailable, PremiumFeature } from "../src/services/organizationPlanPolicy.js";

// Organization Theme (dashboard) — Premium Fase 2D.1, corrección post-
// revisión. CRUD real contra Postgres real (backend/.env.test), mismo
// criterio/helpers que organizationPublicPage.test.js. Guardrail
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

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            slug: `sala-${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            plan: "FREE",
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

testWithDb("PRIVATE-THEME-A: Organization con CUSTOM_BRANDING habilitado -> /organizations/me trae branding.enabled=true y valores visuales", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "PREMIUM",
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#0000FF",
        });

        const result = await getMyOrganizationService(owner.clerkId);
        assert.equal(result.branding.enabled, true);
        assert.equal(result.logo, "https://cdn.example.com/logo.png");
        assert.equal(result.brandPrimaryColor, "#0000FF");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PRIVATE-THEME-B: Organization sin CUSTOM_BRANDING -> branding.enabled=false (no habilita Organization Theme)", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "FREE",
            logo: "https://cdn.example.com/legacy-logo.png",
            brandPrimaryColor: "#00FF00",
        });

        const result = await getMyOrganizationService(owner.clerkId);
        assert.equal(result.branding.enabled, false);
        // El dato sigue viajando (es el panel del propio dueño, no la
        // página pública) — lo que cambia es que el frontend no debe
        // activar el theme con esto.
        assert.equal(result.logo, "https://cdn.example.com/legacy-logo.png");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PRIVATE-THEME-C: branding.enabled se resuelve mediante la policy existente (isFeatureAvailable), no por comparación de plan ad-hoc", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });

        const result = await getMyOrganizationService(owner.clerkId);
        const expected = isFeatureAvailable(org, PremiumFeature.CUSTOM_BRANDING);
        assert.equal(result.branding.enabled, expected);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});
