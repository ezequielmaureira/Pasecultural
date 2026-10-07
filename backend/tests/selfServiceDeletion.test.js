import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    deleteMyOrganizationService,
    getMyOrganizationService,
    createOrganizationService,
    getPublicOrganizationBySlugService,
} from "../src/services/organization.service.js";
import { getPublicEventBySlugService, getPublicEventsService, getQuickPassBySlugService } from "../src/services/event.service.js";
import { deleteMyAccountService } from "../src/services/auth.service.js";
import { requestSaleRecoveryCodeService } from "../src/services/saleRecoveryVerification.service.js";

// Autoservicio "Eliminar organización" (hard delete con antecedente
// DeletedOrganization, bloqueado si hay obligaciones vivas) y
// "Eliminar mi cuenta" (desvincula Clerk, conserva el User y su historial).
// Tests contra Postgres real (backend/.env.test), nunca mocks de Prisma —
// ver tests/helpers/dbGuard.js. Clerk nunca se llama de verdad: la
// eliminación de identidad se inyecta (deleteIdentity).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function hoursFromNow(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// Resend (alerta Developer de organización nueva, código de recuperación):
// siempre interceptado, nunca un envío real.
function mockResendFetch() {
    const original = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes("api.resend.com/emails")) {
            sent.push(JSON.parse(opts.body));
            return { ok: true, status: 200, headers: { entries: () => [] }, json: async () => ({ id: `resend-test-${uniqueSuffix()}` }) };
        }
        throw new Error(`unexpected fetch call to ${u}`);
    };
    return {
        sent,
        restore: () => {
            globalThis.fetch = original;
        },
    };
}

async function createUser({ role = "CUSTOMER", withClerk = true } = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: withClerk ? `clerk_${suffix}` : null,
            email: `selfdelete_${suffix}@example.com`,
            firstName: "Persona",
            lastName: `Test${suffix}`,
            imageUrl: "https://example.com/avatar.png",
            role,
        },
    });
}

// Organización APPROVED + PREMIUM (página pública habilitada) con un evento
// publicado y público y una función (futura por default) — el escenario más
// "visible" posible antes de eliminarla.
async function createOrganizationWithHistory(owner, { functionHoursFromNow = 48 } = {}) {
    const suffix = uniqueSuffix();
    const organization = await prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            slug: `sala-${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            plan: "PREMIUM",
            ownerId: owner.id,
        },
    });
    const event = await prisma.event.create({
        data: {
            title: `Evento ${suffix}`,
            slug: `evento-${suffix}`,
            createdBy: owner.id,
            organizationId: organization.id,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            startDate: hoursFromNow(48),
            quickPassEnabled: true,
            quickPassImageUrl: "https://example.com/pass.png",
        },
    });
    const eventFunction = await prisma.eventFunction.create({
        data: { eventId: event.id, date: hoursFromNow(functionHoursFromNow), venue: "Plaza Central" },
    });
    const ticketType = await prisma.ticketType.create({
        data: { eventId: event.id, name: `General ${suffix}`, price: 1000, quantity: 100 },
    });
    return { organization, event, eventFunction, ticketType };
}

async function createConfirmedSale({ event, eventFunction, ticketType, buyer, buyerDocument }) {
    const sale = await prisma.sale.create({
        data: {
            status: "CONFIRMED",
            paymentMethod: "MANUAL",
            total: 1000,
            buyerId: buyer.id,
            buyerDocument,
            eventId: event.id,
            functionId: eventFunction.id,
            confirmedAt: new Date(),
            publicRecoveryToken: randomUUID(),
        },
    });
    const ticket = await prisma.ticket.create({
        data: {
            ticketNumber: `TEST-${uniqueSuffix()}`,
            saleId: sale.id,
            eventId: event.id,
            functionId: eventFunction.id,
            ticketTypeId: ticketType.id,
            buyerId: buyer.id,
            ownerId: buyer.id,
        },
    });
    return { sale, ticket };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [], recoveryPairs = [] }) {
    for (const [normalizedEmail, normalizedDocument] of recoveryPairs) {
        await prisma.saleRecoveryVerification.deleteMany({ where: { normalizedEmail, normalizedDocument } }).catch(() => {});
    }
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.sale.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.deletedOrganization.deleteMany({ where: { originalOrganizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ==================================================================
// Organización
// ==================================================================

testWithDb("ORG-A/B/C/D: eliminar con historial pasado => hard delete, antecedente, evento archivado y desacoplado, ventas intactas, CUSTOMER", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const buyer = await createUser({ withClerk: false });
    const ctx = await createOrganizationWithHistory(owner, { functionHoursFromNow: -72 });
    const { sale, ticket } = await createConfirmedSale({ ...ctx, buyer, buyerDocument: "40111111" });
    try {
        const result = await deleteMyOrganizationService(owner.clerkId, { confirmation: "ELIMINAR" });
        assert.equal(result.mode, "deleted");
        assert.ok(result.deletedAt instanceof Date);

        assert.equal(await prisma.organization.findUnique({ where: { id: ctx.organization.id } }), null, "A: la Organization se borra");
        const deleted = await prisma.deletedOrganization.findUnique({ where: { originalOrganizationId: ctx.organization.id } });
        assert.ok(deleted);
        assert.equal(deleted.reason, "DELETED_BY_USER");
        assert.equal(deleted.name, ctx.organization.name);
        assert.equal(deleted.plan, "PREMIUM");
        assert.equal(deleted.ownerId, owner.id);
        assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).role, "CUSTOMER");

        const event = await prisma.event.findUnique({ where: { id: ctx.event.id } });
        assert.ok(event, "B: el evento con historial se conserva");
        assert.equal(event.organizationId, null);
        assert.equal(event.deletedOrganizationId, deleted.id);
        assert.ok(event.archivedAt, "B: queda archivado");
        assert.equal(event.status, "PUBLISHED", "B: nunca pasa a CANCELLED");
        assert.ok(await prisma.sale.findUnique({ where: { id: sale.id } }), "C: la venta se conserva");
        const keptTicket = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        assert.ok(keptTicket && !keptTicket.deletedAt && keptTicket.status === "ACTIVE", "C: el ticket se conserva intacto");

        assert.equal(await getMyOrganizationService(owner.clerkId), null, "D: ya no tiene organización");
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [ctx.organization.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("ORG-BLOCK: función futura con entradas activas => 409 ORGANIZATION_DELETE_BLOCKED y nada cambia", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const buyer = await createUser({ withClerk: false });
    const ctx = await createOrganizationWithHistory(owner);
    await createConfirmedSale({ ...ctx, buyer, buyerDocument: "40333333" });
    try {
        await assert.rejects(
            deleteMyOrganizationService(owner.clerkId, { confirmation: "ELIMINAR" }),
            (err) =>
                err.code === "ORGANIZATION_DELETE_BLOCKED" &&
                err.httpStatus === 409 &&
                err.details.some((b) => b.code === "UPCOMING_ACTIVE_TICKETS" && b.count === 1)
        );
        assert.ok(await prisma.organization.findUnique({ where: { id: ctx.organization.id } }));
        assert.equal(await prisma.deletedOrganization.count({ where: { originalOrganizationId: ctx.organization.id } }), 0);
        assert.equal((await prisma.event.findUnique({ where: { id: ctx.event.id } })).organizationId, ctx.organization.id);
        assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).role, "ORGANIZER");
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [ctx.organization.id], userIds: [owner.id, buyer.id] });
    }
});

testWithDb("ORG: confirmación incorrecta => error y nada cambia", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const ctx = await createOrganizationWithHistory(owner);
    try {
        await assert.rejects(
            deleteMyOrganizationService(owner.clerkId, { confirmation: "eliminar" }),
            (err) => err.code === "ORGANIZATION_DELETE_CONFIRMATION_REQUIRED" && err.httpStatus === 400
        );
        const org = await prisma.organization.findUnique({ where: { id: ctx.organization.id } });
        assert.ok(org);
        assert.equal(org.status, "APPROVED");
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [ctx.organization.id], userIds: [owner.id] });
    }
});

testWithDb("ORG-E/F/G/H: organización eliminada desaparece de lo público (página, evento directo, listado, Quick/Fest Pass)", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const ctx = await createOrganizationWithHistory(owner);
    try {
        // Sanity: antes de cerrar, todo es público.
        assert.ok(await getPublicEventBySlugService(ctx.event.slug));
        assert.equal((await getQuickPassBySlugService(ctx.event.slug)).available, true);

        await deleteMyOrganizationService(owner.clerkId, { confirmation: "ELIMINAR" });
        // Sin ventas/entradas: el evento se borra físicamente.
        assert.equal(await prisma.event.findUnique({ where: { id: ctx.event.id } }), null);

        await assert.rejects(getPublicOrganizationBySlugService(ctx.organization.slug), /ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE/);
        assert.equal(await getPublicEventBySlugService(ctx.event.slug), null);
        const listed = await getPublicEventsService({ search: ctx.event.title });
        assert.ok(!listed.some((e) => e.id === ctx.event.id));
        const bySlug = await getPublicEventsService({ organizationSlug: ctx.organization.slug });
        assert.equal(bySlug.length, 0);
        assert.equal((await getQuickPassBySlugService(ctx.event.slug)).available, false);
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [ctx.organization.id], userIds: [owner.id] });
    }
});

testWithDb("ORG-I: después de eliminar puede crear una organización nueva (la vieja queda sólo como antecedente)", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const ctx = await createOrganizationWithHistory(owner);
    const mock = mockResendFetch();
    let newOrgId = null;
    try {
        await deleteMyOrganizationService(owner.clerkId, { confirmation: "ELIMINAR" });

        const { organization, user } = await createOrganizationService(owner.clerkId, {
            name: `Nueva ${uniqueSuffix()}`,
            email: `nueva_${uniqueSuffix()}@example.com`,
        });
        newOrgId = organization.id;
        assert.notEqual(organization.id, ctx.organization.id);
        assert.equal(organization.closedAt, null);
        assert.equal(user.role, "ORGANIZER");
        assert.equal((await getMyOrganizationService(owner.clerkId)).id, organization.id);
        assert.equal(await prisma.organization.findUnique({ where: { id: ctx.organization.id } }), null);
        assert.ok(await prisma.deletedOrganization.findUnique({ where: { originalOrganizationId: ctx.organization.id } }));
    } finally {
        mock.restore();
        await cleanup({
            eventIds: [ctx.event.id],
            organizationIds: [ctx.organization.id, ...(newOrgId ? [newOrgId] : [])],
            userIds: [owner.id],
        });
    }
});

// ==================================================================
// Cuenta
// ==================================================================

testWithDb("ACC-J/K/L: customer elimina su cuenta => clerkId null, historial intacto, recuperación pública sigue funcionando", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const customer = await createUser();
    const buyerDocument = "40222222";
    const ctx = await createOrganizationWithHistory(owner);
    const { sale, ticket } = await createConfirmedSale({ ...ctx, buyer: customer, buyerDocument });
    const deletedIdentities = [];
    const mock = mockResendFetch();
    try {
        const result = await deleteMyAccountService(
            customer.clerkId,
            { confirmation: "ELIMINAR" },
            { deleteIdentity: async (id) => deletedIdentities.push(id) }
        );
        assert.deepEqual(result, { deleted: true });
        assert.deepEqual(deletedIdentities, [customer.clerkId]);

        const after = await prisma.user.findUnique({ where: { id: customer.id } });
        assert.equal(after.clerkId, null);
        assert.equal(after.imageUrl, null);
        assert.equal(after.role, "CUSTOMER");
        assert.equal(after.email, customer.email, "el email se conserva para la recuperación");

        assert.ok(await prisma.sale.findUnique({ where: { id: sale.id } }), "K: la venta se conserva");
        assert.ok(await prisma.ticket.findUnique({ where: { id: ticket.id } }), "K: el ticket se conserva");

        const recovery = await requestSaleRecoveryCodeService({ email: customer.email, buyerDocument });
        assert.equal(recovery.matched, true, "L: la recuperación pública sigue encontrando la compra");
        assert.equal(mock.sent.length, 1);
    } finally {
        mock.restore();
        await cleanup({
            eventIds: [ctx.event.id],
            organizationIds: [ctx.organization.id],
            userIds: [owner.id, customer.id],
            recoveryPairs: [[customer.email, buyerDocument]],
        });
    }
});

testWithDb("ACC-M: con organización activa => 409 y la cuenta NO se elimina", async () => {
    const owner = await createUser({ role: "ORGANIZER" });
    const ctx = await createOrganizationWithHistory(owner);
    let called = false;
    try {
        await assert.rejects(
            deleteMyAccountService(owner.clerkId, { confirmation: "ELIMINAR" }, { deleteIdentity: async () => (called = true) }),
            (err) => err.code === "ACCOUNT_HAS_ACTIVE_ORGANIZATION" && err.httpStatus === 409
        );
        assert.equal(called, false);
        const after = await prisma.user.findUnique({ where: { id: owner.id } });
        assert.equal(after.clerkId, owner.clerkId);
        assert.equal(after.role, "ORGANIZER");
        assert.ok(await prisma.organization.findUnique({ where: { id: ctx.organization.id } }));
    } finally {
        await cleanup({ eventIds: [ctx.event.id], organizationIds: [ctx.organization.id], userIds: [owner.id] });
    }
});

testWithDb("ACC-N: DEVELOPER => 403", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        await assert.rejects(
            deleteMyAccountService(developer.clerkId, { confirmation: "ELIMINAR" }, { deleteIdentity: async () => {} }),
            (err) => err.code === "ACCOUNT_DELETE_DEVELOPER_FORBIDDEN" && err.httpStatus === 403
        );
        assert.equal((await prisma.user.findUnique({ where: { id: developer.id } })).clerkId, developer.clerkId);
    } finally {
        await cleanup({ userIds: [developer.id] });
    }
});

testWithDb("ACC-O: confirmación incorrecta => 400", async () => {
    const customer = await createUser();
    try {
        await assert.rejects(
            deleteMyAccountService(customer.clerkId, { confirmation: "SI" }, { deleteIdentity: async () => {} }),
            (err) => err.code === "ACCOUNT_DELETE_CONFIRMATION_REQUIRED" && err.httpStatus === 400
        );
        assert.equal((await prisma.user.findUnique({ where: { id: customer.id } })).clerkId, customer.clerkId);
    } finally {
        await cleanup({ userIds: [customer.id] });
    }
});

testWithDb("ACC-P: si Clerk falla, el User se restaura (clerkId/role/imageUrl)", async () => {
    const customer = await createUser();
    try {
        await assert.rejects(
            deleteMyAccountService(
                customer.clerkId,
                { confirmation: "ELIMINAR" },
                {
                    deleteIdentity: async () => {
                        const err = new Error("clerk down");
                        err.status = 500;
                        throw err;
                    },
                }
            ),
            (err) => err.code === "ACCOUNT_DELETE_IDENTITY_FAILED"
        );
        const after = await prisma.user.findUnique({ where: { id: customer.id } });
        assert.equal(after.clerkId, customer.clerkId);
        assert.equal(after.role, customer.role);
        assert.equal(after.imageUrl, customer.imageUrl);
    } finally {
        await cleanup({ userIds: [customer.id] });
    }
});
