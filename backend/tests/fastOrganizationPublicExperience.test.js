import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getPublicEventsService } from "../src/services/event.service.js";
import { getPublicOrganizationBySlugService } from "../src/services/organization.service.js";

// Suite focalizada — Fast Organization Public Experience (ver el informe de
// la ronda). NO mezclar con organizationPublicPage.test.js (contrato legacy
// del endpoint de organización) ni con ningún test general de /eventos.
// Mismo patrón/guardrail que el resto: Postgres real (backend/.env.test),
// nunca mocks de Prisma — ver tests/helpers/dbGuard.js.
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

// FOPE-A: organizationSlug de una Organization PREMIUM devuelve
// exclusivamente los eventos públicos de ESA organización.
testWithDb("FOPE-A: organizationSlug (PREMIUM) devuelve sólo los eventos de esa organización", async () => {
    const owner = await createUser();
    let orgA, orgB, eventA, eventB;
    try {
        orgA = await createOrganization(owner.id, { plan: "PREMIUM" });
        orgB = await createOrganization(owner.id, { plan: "PREMIUM" });
        eventA = await createEvent(orgA, owner);
        eventB = await createEvent(orgB, owner);

        const events = await getPublicEventsService({ organizationSlug: orgA.slug });
        assert.equal(events.length, 1);
        assert.equal(events[0].id, eventA.id);
        assert.equal(events[0].organization.id, orgA.id);
    } finally {
        await cleanup({ eventIds: [eventA?.id, eventB?.id], organizationIds: [orgA?.id, orgB?.id], userIds: [owner.id] });
    }
});

// FOPE-B: organizationSlug de una Organization FREE devuelve [].
testWithDb("FOPE-B: organizationSlug (FREE) devuelve [] aunque tenga eventos publicados", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        event = await createEvent(org, owner);

        const events = await getPublicEventsService({ organizationSlug: org.slug });
        assert.deepEqual(events, []);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-C: organizationSlug inexistente devuelve [] sin exponer nada ni
// lanzar — el filtro vive en el propio findMany, nunca en un
// organization.findUnique previo que pudiera lanzar/distinguir el caso.
testWithDb("FOPE-C: organizationSlug inexistente devuelve [] sin lanzar", async () => {
    const events = await getPublicEventsService({ organizationSlug: `no-existe-${uniqueSuffix()}` });
    assert.deepEqual(events, []);
});

// FOPE-D: los filtros existentes de /events/public siguen funcionando sin
// organizationSlug (regresión mínima de compatibilidad).
testWithDb("FOPE-D: filtros existentes (category, price=gratis) funcionan sin organizationSlug", async () => {
    const owner = await createUser();
    let org, freeEvent, paidEvent;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        freeEvent = await createEvent(org, owner, { isFree: true, category: "MUSICA" });
        paidEvent = await createEvent(org, owner, { isFree: false, category: "MUSICA" });

        const gratis = await getPublicEventsService({ price: "gratis" });
        const gratisIds = gratis.map((e) => e.id);
        assert.ok(gratisIds.includes(freeEvent.id));
        assert.ok(!gratisIds.includes(paidEvent.id));
    } finally {
        await cleanup({ eventIds: [freeEvent?.id, paidEvent?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-E: organizationSlug combinado con un filtro existente (price=gratis)
// funciona sin romper ninguno de los dos.
testWithDb("FOPE-E: organizationSlug + price=gratis se combinan correctamente", async () => {
    const owner = await createUser();
    let org, freeEvent, paidEvent;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        freeEvent = await createEvent(org, owner, { isFree: true });
        paidEvent = await createEvent(org, owner, { isFree: false });

        const events = await getPublicEventsService({ organizationSlug: org.slug, price: "gratis" });
        assert.equal(events.length, 1);
        assert.equal(events[0].id, freeEvent.id);
    } finally {
        await cleanup({ eventIds: [freeEvent?.id, paidEvent?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-F: /organizations/public/:slug?includeEvents=false devuelve
// identidad pública autorizada, SIN ejecutar/devolver eventos.
testWithDb("FOPE-F: includeEvents:false devuelve identidad sin la clave events", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM", logo: "https://cdn.example.com/logo.png" });
        event = await createEvent(org, owner);

        const result = await getPublicOrganizationBySlugService(org.slug, { includeEvents: false });
        assert.equal(result.organization.id, org.id);
        assert.equal(result.organization.slug, org.slug);
        assert.equal(result.organization.logo, "https://cdn.example.com/logo.png");
        assert.equal(Object.hasOwn(result, "events"), false, "includeEvents:false nunca debe incluir la clave events");
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-G: el comportamiento legacy (sin includeEvents, o includeEvents:true)
// permanece intacto — misma forma { organization, events } de siempre.
testWithDb("FOPE-G: comportamiento legacy (includeEvents por default) permanece intacto", async () => {
    const owner = await createUser();
    let org, event;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });
        event = await createEvent(org, owner);

        const defaultResult = await getPublicOrganizationBySlugService(org.slug);
        assert.equal(Object.hasOwn(defaultResult, "events"), true);
        assert.equal(defaultResult.events.length, 1);
        assert.equal(defaultResult.events[0].id, event.id);

        const explicitTrueResult = await getPublicOrganizationBySlugService(org.slug, { includeEvents: true });
        assert.equal(explicitTrueResult.events.length, 1);
    } finally {
        await cleanup({ eventIds: [event?.id], organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-H: FREE sigue produciendo ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE con
// includeEvents:false — la autorización nunca se saltea por el nuevo flag.
testWithDb("FOPE-H: includeEvents:false respeta igual la autorización PREMIUM (FREE sigue no disponible)", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "FREE" });
        await assert.rejects(
            () => getPublicOrganizationBySlugService(org.slug, { includeEvents: false }),
            (err) => err.message === "ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE"
        );
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});

// FOPE-I: sin eventos (Premium real, cero eventos publicados) la identidad
// sigue resolviendo correctamente y el listado de eventos por slug es [].
// Cubre conceptualmente "caso sin eventos" del frontend: identidad !=
// notFound, events == [].
testWithDb("FOPE-I: Premium sin eventos publicados resuelve identidad OK y eventos []", async () => {
    const owner = await createUser();
    let org;
    try {
        org = await createOrganization(owner.id, { plan: "PREMIUM" });

        const identity = await getPublicOrganizationBySlugService(org.slug, { includeEvents: false });
        assert.equal(identity.organization.id, org.id);

        const events = await getPublicEventsService({ organizationSlug: org.slug });
        assert.deepEqual(events, []);
    } finally {
        await cleanup({ organizationIds: [org?.id], userIds: [owner.id] });
    }
});
