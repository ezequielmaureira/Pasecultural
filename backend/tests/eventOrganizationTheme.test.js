import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getPublicEventBySlugService } from "../src/services/event.service.js";

// Organization Theme (público) — Premium Fase 2D.1. CRUD real contra
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

testWithDb("THEME-A: evento de Organization PREMIUM con CUSTOM_BRANDING expone branding autorizado", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, {
            plan: "PREMIUM",
            logo: "https://cdn.example.com/logo.png",
            brandPrimaryColor: "#0000FF",
        });
        event = await createEvent(org, owner);

        const result = await getPublicEventBySlugService(event.slug);
        assert.equal(result.organization.slug, org.slug);
        assert.equal(result.organization.branding.logo, "https://cdn.example.com/logo.png");
        assert.equal(result.organization.branding.primaryColor, "#0000FF");
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("THEME-B: evento de Organization FREE no expone/aplica branding Premium", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, {
            plan: "FREE",
            logo: "https://cdn.example.com/legacy-logo.png",
            brandPrimaryColor: "#00FF00",
        });
        event = await createEvent(org, owner);

        const result = await getPublicEventBySlugService(event.slug);
        assert.equal(result.organization.branding.logo, null);
        assert.equal(result.organization.branding.primaryColor, null);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("THEME-C: la respuesta pública del evento nunca contiene organization.plan", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", brandPrimaryColor: "#0000FF" });
        event = await createEvent(org, owner);

        const result = await getPublicEventBySlugService(event.slug);
        assert.equal(Object.hasOwn(result.organization, "plan"), false);
        assert.equal(Object.hasOwn(result.organization, "brandPrimaryColor"), false);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("THEME-D: Organization.logo legacy de FREE no habilita branding por sí solo", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "FREE", logo: "https://cdn.example.com/legacy.png" });
        event = await createEvent(org, owner);

        const result = await getPublicEventBySlugService(event.slug);
        assert.equal(result.organization.branding.logo, null);
        // El logo "general" (no-branding) de la Organization sigue viajando
        // tal cual estaba antes de esta fase — sólo `branding.logo` está
        // gateado.
        assert.equal(result.organization.logo, "https://cdn.example.com/legacy.png");
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

testWithDb("THEME-E: el branding del evento de la Organization A nunca usa datos de la Organization B", async () => {
    const owner = await createUser();
    let orgA, orgB, eventA, eventB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM", brandPrimaryColor: "#0000FF" });
        orgB = await createOrganization(owner.id, { plan: "PREMIUM", brandPrimaryColor: "#FF0000" });
        eventA = await createEvent(orgA, owner);
        eventB = await createEvent(orgB, owner);

        const resultA = await getPublicEventBySlugService(eventA.slug);
        const resultB = await getPublicEventBySlugService(eventB.slug);

        assert.equal(resultA.organization.branding.primaryColor, "#0000FF");
        assert.equal(resultB.organization.branding.primaryColor, "#FF0000");
        assert.notEqual(resultA.organization.id, resultB.organization.id);
    } finally {
        await cleanup({ eventIds: [eventA?.id, eventB?.id], organizationIds: [orgA?.id, orgB?.id], userIds: [owner.id] });
    }
});

testWithDb("THEME-F: los campos existentes de organization usados por EventDetail (id, name, logo) no se rompen", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", logo: "https://cdn.example.com/logo.png", brandPrimaryColor: "#0000FF" });
        event = await createEvent(org, owner);

        const result = await getPublicEventBySlugService(event.slug);
        assert.equal(result.organization.id, org.id);
        assert.equal(result.organization.name, org.name);
        assert.equal(result.organization.logo, "https://cdn.example.com/logo.png");
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});
