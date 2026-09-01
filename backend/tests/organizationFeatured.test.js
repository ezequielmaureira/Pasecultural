import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getFeaturedOrganizationsService } from "../src/services/organization.service.js";
import organizationRouter from "../src/routes/organization.routes.js";

// Premium 2E — "Organizaciones destacadas" en Home. CRUD real contra
// Postgres real (backend/.env.test), mismo criterio/helpers que
// organizationPublicPage.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
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

testWithDb("FEAT-A: una Organization FREE nunca aparece en destacadas", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        const { organizations } = await getFeaturedOrganizationsService();
        assert.ok(!organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-B: una Organization PREMIUM elegible aparece en destacadas", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const { organizations } = await getFeaturedOrganizationsService();
        assert.ok(organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-C: PREMIUM sin slug no aparece (misma exigencia que la página pública)", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", slug: null });
        const { organizations } = await getFeaturedOrganizationsService();
        assert.ok(!organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-D: nunca devuelve más de 10 aunque existan más elegibles", async () => {
    const owner = await createUser();
    const orgs = [];
    try {
        for (let i = 0; i < 15; i += 1) {
            orgs.push(await createOrganization(owner.id, { plan: "PREMIUM" }));
        }
        const { organizations } = await getFeaturedOrganizationsService();
        const ourIds = new Set(orgs.map((o) => o.id));
        const matched = organizations.filter((o) => ourIds.has(o.id));
        assert.ok(organizations.length <= 10, "la respuesta completa nunca debe superar 10");
        // Con 15 elegibles propias en la tanda, la selección de las top-10
        // reales (orden global por updatedAt/id) puede incluir organizaciones
        // de OTRAS corridas/tests que quedaron con updatedAt más reciente —
        // lo que este caso prueba de forma robusta es el techo global, no
        // cuántas de las nuestras entraron.
        assert.ok(matched.length <= 10);
    } finally {
        await cleanup({ organizationIds: orgs.map((o) => o.id), userIds: [owner.id] });
    }
});

testWithDb("FEAT-E: la respuesta nunca expone `plan`", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const { organizations } = await getFeaturedOrganizationsService();
        const found = organizations.find((o) => o.id === org.id);
        assert.ok(found, "la organización de este test debe estar en la respuesta");
        assert.equal(Object.hasOwn(found, "plan"), false);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-F: la respuesta nunca expone owner/ownerId/email/datos privados", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", phone: "+5491111111111" });
        const { organizations } = await getFeaturedOrganizationsService();
        const found = organizations.find((o) => o.id === org.id);
        assert.ok(found);
        const forbiddenKeys = [
            "ownerId", "owner", "email", "phone", "phoneVerifiedAt", "cuit",
            "responsibleFirstName", "responsibleLastName", "responsibleDni",
            "status", "approvedAt", "approvedBy", "plan", "planUpdatedAt",
            "planUpdatedByUserId", "createdAt", "updatedAt",
            "brandPrimaryColor", "brandSecondaryColor",
        ];
        for (const key of forbiddenKeys) {
            assert.equal(Object.hasOwn(found, key), false, `no debe exponer ${key}`);
        }
        // Whitelist exacta esperada.
        assert.deepEqual(Object.keys(found).sort(), ["city", "logo", "name", "province", "slug", "id"].sort());
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-G: orden determinista (updatedAt desc, id como desempate)", async () => {
    const owner = await createUser();
    let orgOld, orgNew;
    try {
        orgOld = await createOrganization(owner.id, { plan: "PREMIUM" });
        orgNew = await createOrganization(owner.id, { plan: "PREMIUM" });
        // Fuerza updatedAt de orgNew a ser estrictamente posterior — evita
        // depender de que dos `create` consecutivos caigan en el mismo
        // milisegundo.
        await prisma.organization.update({
            where: { id: orgNew.id },
            data: { updatedAt: new Date(Date.now() + 1000) },
        });

        const { organizations } = await getFeaturedOrganizationsService();
        const indexNew = organizations.findIndex((o) => o.id === orgNew.id);
        const indexOld = organizations.findIndex((o) => o.id === orgOld.id);
        assert.ok(indexNew !== -1 && indexOld !== -1, "ambas deben estar en la respuesta");
        assert.ok(indexNew < indexOld, "la actualizada más recientemente debe ir primero");
    } finally {
        await cleanup({ organizationIds: [orgOld?.id, orgNew?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-I: PREMIUM sin logo puede aparecer, con logo=null", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", logo: null });
        const { organizations } = await getFeaturedOrganizationsService();
        const found = organizations.find((o) => o.id === org.id);
        assert.ok(found, "una Premium sin logo debe aparecer igual");
        assert.equal(found.logo, null);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("FEAT-J: una Organization sin página pública habilitada (FREE) nunca es descubrible, aunque tenga logo/actividad", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "FREE",
            logo: "https://cdn.example.com/logo.png",
            city: "Buenos Aires",
        });
        const { organizations } = await getFeaturedOrganizationsService();
        assert.ok(!organizations.some((o) => o.id === org.id));
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// No requiere DB ni servidor HTTP levantado — inspecciona directamente la
// estructura del router ya montado para confirmar, sin adivinar, que:
// (1) "/public/featured" está registrada ANTES que "/public/:slug" (si no
// lo estuviera, Express matchearía "featured" como si fuera un slug), y
// (2) ambas quedan detrás de requirePublicLaunch (mismo mecanismo que ya
// protege el resto del contenido público comercial durante Prelanzamiento).
// Corre siempre (no depende de `hasDatabase`) — es introspección de código,
// no una operación contra Prisma.
test("FEAT-H: /public/featured está registrada antes que /public/:slug y detrás de requirePublicLaunch", () => {
    const routeLayers = organizationRouter.stack.filter((layer) => layer.route);
    const middlewareLayers = organizationRouter.stack.filter(
        (layer) => !layer.route && layer.name === "requirePublicLaunch"
    );

    const featuredIndex = organizationRouter.stack.findIndex(
        (layer) => layer.route?.path === "/public/featured"
    );
    const slugIndex = organizationRouter.stack.findIndex(
        (layer) => layer.route?.path === "/public/:slug"
    );
    const publicLaunchIndex = organizationRouter.stack.findIndex(
        (layer) => !layer.route && layer.name === "requirePublicLaunch"
    );

    assert.ok(featuredIndex !== -1, "la ruta /public/featured debe existir");
    assert.ok(slugIndex !== -1, "la ruta /public/:slug debe seguir existiendo");
    assert.ok(publicLaunchIndex !== -1, "requirePublicLaunch debe seguir montado en este router");
    assert.ok(publicLaunchIndex < featuredIndex, "requirePublicLaunch debe registrarse antes que /public/featured");
    assert.ok(featuredIndex < slugIndex, "/public/featured debe registrarse antes que /public/:slug");

    // Defensivo: si en el futuro Express cambia el shape interno de
    // `router.stack` estas listas quedarían vacías — falla fuerte en vez
    // de un test silenciosamente inútil.
    assert.ok(routeLayers.length > 0);
    assert.ok(middlewareLayers.length > 0);
});
