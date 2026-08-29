import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { updateOrganizationBrandingService } from "../src/services/organization.service.js";

// Premium — Fase 2D. CRUD real contra Postgres real (backend/.env.test),
// mismo criterio/helpers que organizationPublicPage.test.js. Guardrail
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

testWithDb("BR-A: el owner PREMIUM puede actualizar el branding de su propia Organization", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const result = await updateOrganizationBrandingService(owner.clerkId, org.id, {
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#7C3AED",
        });
        assert.equal(result.logo, "https://cdn.example.com/logo.png");
        assert.equal(result.brandPrimaryColor, "#7C3AED");

        const stored = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(stored.logo, "https://cdn.example.com/logo.png");
        assert.equal(stored.brandPrimaryColor, "#7C3AED");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-B: una Organization FREE no puede actualizar su branding", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        await assert.rejects(
            () => updateOrganizationBrandingService(owner.clerkId, org.id, { brandPrimaryColor: "#7C3AED" }),
            (err) => err.message === "PREMIUM_FEATURE_REQUIRED"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-C: un ORGANIZER no puede modificar el branding de una Organization ajena", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        await assert.rejects(
            () => updateOrganizationBrandingService(stranger.clerkId, org.id, { brandPrimaryColor: "#7C3AED" }),
            (err) => err.message === "ORGANIZATION_BRANDING_FORBIDDEN"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id, stranger.id] });
    }
});

testWithDb("BR-D: un owner con dos Organizations actualiza exactamente la :id indicada", async () => {
    const owner = await createUser();
    let orgA, orgB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM" });
        // Segunda Organization del mismo owner creada directo por Prisma —
        // createOrganizationService no lo permite (devuelve la existente),
        // mismo criterio que organizationSlug.crud.test.js#REGRESIÓN.
        orgB = await createOrganization(owner.id, { plan: "PREMIUM" });

        await updateOrganizationBrandingService(owner.clerkId, orgB.id, { brandPrimaryColor: "#111111" });

        const storedA = await prisma.organization.findUnique({ where: { id: orgA.id } });
        const storedB = await prisma.organization.findUnique({ where: { id: orgB.id } });
        assert.equal(storedA.brandPrimaryColor, null);
        assert.equal(storedB.brandPrimaryColor, "#111111");
    } finally {
        await cleanup({ organizationIds: [orgA?.id, orgB?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-E: un color inválido es rechazado", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        for (const invalid of ["#FFF", "rgb(0,0,0)", "javascript:alert(1)", "red", "var(--x)"]) {
            await assert.rejects(
                () => updateOrganizationBrandingService(owner.clerkId, org.id, { brandPrimaryColor: invalid }),
                (err) => err.message === "ORGANIZATION_BRANDING_INVALID_COLOR",
                `debía rechazar "${invalid}"`
            );
        }
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-F: brandPrimaryColor null se acepta y restaura el estilo por defecto", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", brandPrimaryColor: "#7C3AED" });
        const result = await updateOrganizationBrandingService(owner.clerkId, org.id, { brandPrimaryColor: null });
        assert.equal(result.brandPrimaryColor, null);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-G: el downgrade a FREE no borra el logo/color ya guardados", async () => {
    const owner = await createUser();
    const developer = await createUser({ role: "DEVELOPER" });
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "PREMIUM",
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#7C3AED",
        });

        // Downgrade directo (mismo shape que updateOrganizationPlanService,
        // sin necesidad de pasar por el controller Developer acá).
        await prisma.organization.update({
            where: { id: org.id },
            data: { plan: "FREE", planUpdatedAt: new Date(), planUpdatedByUserId: developer.id },
        });

        const stored = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(stored.logo, "https://cdn.example.com/logo.png");
        assert.equal(stored.brandPrimaryColor, "#7C3AED");

        // Y el endpoint de edición ya no lo permite modificar.
        await assert.rejects(
            () => updateOrganizationBrandingService(owner.clerkId, org.id, { brandPrimaryColor: "#000000" }),
            (err) => err.message === "PREMIUM_FEATURE_REQUIRED"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id, developer.id] });
    }
});

testWithDb("BR-H: el upgrade a PREMIUM vuelve a exponer el branding previo, sin lógica de restauración", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "FREE",
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#7C3AED",
        });

        await prisma.organization.update({ where: { id: org.id }, data: { plan: "PREMIUM" } });

        const result = await updateOrganizationBrandingService(owner.clerkId, org.id, {});
        assert.equal(result.logo, "https://cdn.example.com/logo.png");
        assert.equal(result.brandPrimaryColor, "#7C3AED");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("BR-I: el PATCH ignora en silencio campos fuera de la whitelist (logo/brandPrimaryColor)", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", website: "https://original.example.com" });
        await updateOrganizationBrandingService(owner.clerkId, org.id, {
            brandPrimaryColor: "#7C3AED",
            website: "https://deberia-ser-ignorado.example.com",
            name: "Nombre que no debería cambiar",
        });

        const stored = await prisma.organization.findUnique({ where: { id: org.id } });
        assert.equal(stored.brandPrimaryColor, "#7C3AED");
        assert.equal(stored.website, "https://original.example.com", "website no es parte de este endpoint");
        assert.notEqual(stored.name, "Nombre que no debería cambiar");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});
