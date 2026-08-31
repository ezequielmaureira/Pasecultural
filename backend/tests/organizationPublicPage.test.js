import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getPublicOrganizationBySlugService } from "../src/services/organization.service.js";
import { getPublicOrganizationBySlug } from "../src/controllers/organization.controller.js";
import { ErrorCatalog } from "../src/errors/ErrorCatalog.js";

// Premium — Fase 2D. CRUD real contra Postgres real (backend/.env.test),
// mismo criterio/helpers que organizationSlug.crud.test.js/eventPlanLimits.test.js.
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

// Fixture mínimo directo por Prisma (no pasa por el wizard completo de
// creación de eventos, igual que eventPlanLimits.test.js no lo necesita
// para casos que sólo ejercitan la lectura pública) — sólo los campos
// obligatorios del modelo (title, slug, createdBy, organizationId) más lo
// que cada caso necesita pisar.
async function createEvent(org, owner, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.event.create({
        data: {
            title: `Evento ${suffix}`,
            slug: `evento-${suffix}`,
            createdBy: owner.id,
            organizationId: org.id,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            ...overrides,
        },
    });
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    const cleanEventIds = eventIds.filter(Boolean);
    const cleanOrgIds = organizationIds.filter(Boolean);
    const cleanUserIds = userIds.filter(Boolean);
    if (cleanEventIds.length) await prisma.event.deleteMany({ where: { id: { in: cleanEventIds } } });
    if (cleanOrgIds.length) await prisma.organization.deleteMany({ where: { id: { in: cleanOrgIds } } });
    if (cleanUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanUserIds } } });
}

function fakeRes() {
    const state = { headers: {} };
    const res = {
        set(key, value) {
            state.headers[key] = value;
            return res;
        },
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

// No toca Prisma: el early-return por slug vacío/null corre antes de
// cualquier consulta — corre siempre, con o sin DB de test disponible.
test("PUB-K: slug null/vacío nunca resuelve una página pública", async () => {
    await assert.rejects(
        () => getPublicOrganizationBySlugService(null),
        (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
    );
    await assert.rejects(
        () => getPublicOrganizationBySlugService(""),
        (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
    );
});

testWithDb("PUB-A: PREMIUM + slug válido devuelve la página pública", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        const result = await getPublicOrganizationBySlugService(org.slug);
        assert.equal(result.organization.id, org.id);
        assert.equal(result.organization.slug, org.slug);
        assert.deepEqual(result.events, []);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-B: FREE + slug válido produce ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        await assert.rejects(
            () => getPublicOrganizationBySlugService(org.slug),
            (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-C: slug inexistente produce exactamente el mismo error que PUB-B", async () => {
    await assert.rejects(
        () => getPublicOrganizationBySlugService(`no-existe-${uniqueSuffix()}`),
        (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
    );
});

testWithDb("PUB-D: la respuesta pública nunca expone campos internos de Organization", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", phone: "+5491111111111" });
        const result = await getPublicOrganizationBySlugService(org.slug);
        const forbiddenKeys = [
            "ownerId", "email", "phone", "phoneVerifiedAt", "cuit",
            "responsibleFirstName", "responsibleLastName", "responsibleDni",
            "status", "approvedAt", "approvedBy", "plan", "planUpdatedAt",
            "planUpdatedByUserId", "createdAt", "updatedAt",
        ];
        for (const key of forbiddenKeys) {
            assert.equal(Object.hasOwn(result.organization, key), false, `organization no debe exponer ${key}`);
        }
        assert.equal(Object.hasOwn(result, "plan"), false, "el objeto raíz nunca debe exponer plan");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-E/F: los eventos de una Organization nunca incluyen los de otra, ni siquiera del mismo owner", async () => {
    const owner = await createUser();
    let orgA, orgB, eventA, eventB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM" });
        orgB = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventA = await createEvent(orgA, owner);
        eventB = await createEvent(orgB, owner);

        const resultA = await getPublicOrganizationBySlugService(orgA.slug);
        assert.equal(resultA.events.length, 1);
        assert.equal(resultA.events[0].id, eventA.id);

        const resultB = await getPublicOrganizationBySlugService(orgB.slug);
        assert.equal(resultB.events.length, 1);
        assert.equal(resultB.events[0].id, eventB.id);
    } finally {
        await cleanup({
            eventIds: [eventA?.id, eventB?.id],
            organizationIds: [orgA?.id, orgB?.id],
            userIds: [owner.id],
        });
    }
});

testWithDb("PUB-G: un evento no público (DRAFT o PRIVATE) no aparece en la página pública", async () => {
    const owner = await createUser();
    let org, publicEvent, draftEvent, privateEvent;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        publicEvent = await createEvent(org, owner);
        draftEvent = await createEvent(org, owner, { status: "DRAFT" });
        privateEvent = await createEvent(org, owner, { visibility: "PRIVATE" });

        const result = await getPublicOrganizationBySlugService(org.slug);
        const ids = result.events.map((e) => e.id);
        assert.ok(ids.includes(publicEvent.id));
        assert.ok(!ids.includes(draftEvent.id));
        assert.ok(!ids.includes(privateEvent.id));
    } finally {
        await cleanup({
            eventIds: [publicEvent?.id, draftEvent?.id, privateEvent?.id],
            organizationIds: [org?.id],
            userIds: [owner.id],
        });
    }
});

testWithDb("PUB-H: archivedAt no se filtra acá — mismo comportamiento actual que /eventos, deliberadamente no corregido en esta fase", async () => {
    const owner = await createUser();
    let org, archivedEvent;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        archivedEvent = await createEvent(org, owner, { archivedAt: new Date() });
        const result = await getPublicOrganizationBySlugService(org.slug);
        assert.ok(
            result.events.some((e) => e.id === archivedEvent.id),
            "un evento archivado pero PUBLISHED/PUBLIC sigue apareciendo, igual que /eventos hoy"
        );
    } finally {
        await cleanup({ eventIds: [archivedEvent?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-I: downgrade PREMIUM->FREE hace que la siguiente request quede no disponible", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        await getPublicOrganizationBySlugService(org.slug);

        await prisma.organization.update({ where: { id: org.id }, data: { plan: "FREE" } });

        await assert.rejects(
            () => getPublicOrganizationBySlugService(org.slug),
            (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-J: upgrade FREE->PREMIUM hace que la siguiente request quede disponible", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        await assert.rejects(() => getPublicOrganizationBySlugService(org.slug));

        await prisma.organization.update({ where: { id: org.id }, data: { plan: "PREMIUM" } });

        const result = await getPublicOrganizationBySlugService(org.slug);
        assert.equal(result.organization.id, org.id);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("PUB-M / COLOR-B: con CUSTOM_BRANDING disponible, logo y ambos colores de marca aparecen correctamente", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "PREMIUM",
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#7C3AED",
            brandSecondaryColor: "#000000",
        });
        const result = await getPublicOrganizationBySlugService(org.slug);
        assert.equal(result.branding.logo, "https://cdn.example.com/logo.png");
        assert.equal(result.branding.primaryColor, "#7C3AED");
        assert.equal(result.branding.secondaryColor, "#000000");
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// PUB-L/PUB-Q: con la implementación actual de organizationPlanPolicy.js
// (fuera de alcance de esta fase — isFeatureAvailable == isPremium para
// TODAS las features hoy), no existe un estado real de datos donde
// PUBLIC_ORGANIZATION_PAGE esté disponible y CUSTOM_BRANDING no lo esté:
// ambas dependen exactamente del mismo isPremium(organization). El service
// SÍ las evalúa con dos llamadas independientes a isFeatureAvailable (listo
// para cuando esa política diverja por feature). Lo que sí es reproducible
// hoy y se prueba acá: un logo/brandPrimaryColor ya guardado en una
// Organization FREE nunca puede filtrarse por este endpoint, porque la
// página entera no está disponible.
testWithDb("PUB-L/PUB-Q / COLOR-E: logo/brandPrimaryColor/brandSecondaryColor de una Organization FREE nunca se filtran (la página entera no está disponible)", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, {
            plan: "FREE",
            logo: "https://cdn.example.com/leak.png",
            brandPrimaryColor: "#123456",
            brandSecondaryColor: "#654321",
        });
        await assert.rejects(
            () => getPublicOrganizationBySlugService(org.slug),
            (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("Cache-Control: no-store tanto en éxito como en el 404 del controller", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });

        const { res: okRes, state: okState } = fakeRes();
        await getPublicOrganizationBySlug({ params: { slug: org.slug } }, okRes);
        assert.equal(okState.statusCode, 200);
        assert.equal(okState.headers["Cache-Control"], "no-store");

        const { res: notFoundRes, state: notFoundState } = fakeRes();
        await getPublicOrganizationBySlug({ params: { slug: `no-existe-${uniqueSuffix()}` } }, notFoundRes);
        assert.equal(notFoundState.statusCode, ErrorCatalog.ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE.httpStatus);
        assert.equal(notFoundState.headers["Cache-Control"], "no-store");
        assert.equal(notFoundState.jsonBody.message, ErrorCatalog.ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE.userMessage);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});
