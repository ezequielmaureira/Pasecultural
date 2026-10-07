import test from "node:test";
import assert from "node:assert/strict";

// "Eliminar organización" por su propietario — hard delete con antecedente
// DeletedOrganization. SIN base de datos (el proyecto de test de Supabase
// no está disponible): DATABASE_URL apunta a un puerto local cerrado ANTES
// de importar Prisma y cada modelo que usa el flujo se reemplaza por un
// store en memoria que además simula las FK RESTRICT reales (borrar una
// Organization/Event con filas colgando lanza P2003, igual que Postgres).
// prisma.$transaction ejecuta el callback sobre ese store y restaura el
// snapshot si lanza (rollback). Ver selfServiceDeletion.test.js para la
// versión contra Postgres real.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;
delete process.env.DEVELOPER_ALERT_EMAIL;

const { default: prisma } = await import("../src/config/prisma.js");
const {
    deleteMyOrganizationService,
    getMyOrganizationService,
    createOrganizationService,
    getOrganizationsService,
    updateOrganizationStatusService,
    updateOrganizationPlanService,
    deleteOrganizationService,
} = await import("../src/services/organization.service.js");
const { updateOrganizationStatus } = await import("../src/controllers/organization.controller.js");
const { errorHandler } = await import("../src/errors/errorHandler.js");
const { resolveEventOrganization } = await import("../src/utils/eventOrganization.js");
const { createSaleForBuyer } = await import("../src/services/sale.service.js");
const { createMercadoPagoCheckoutService } = await import("../src/services/mercadoPagoCheckout.service.js");
const { buildOrganizationContact, createWithdrawalRequestService } = await import("../src/services/withdrawalRequest.service.js");
const { listCandidateConnectionsForOrganization } = await import("../src/services/mercadoPagoReconciliation.service.js");

const DAY = 24 * 60 * 60 * 1000;
const OPERATIVE_MODELS = [
    "mercadoPagoOAuthState",
    "mercadoPagoConnection",
    "whatsappOrganizerLink",
    "whatsappNumberChangeChallenge",
    "organizationPhoneVerification",
    "organizationPhoneChangeAuthorization",
    "organizerNotificationSettings",
    "conversationState",
];

// --- Store en memoria ------------------------------------------------------

let db;
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

function resetDb() {
    db = {
        users: [],
        organizations: [],
        deletedOrganizations: [],
        events: [],
        functions: [],
        sales: [],
        tickets: [],
        withdrawals: [],
        scanners: [],
        pendingSelections: [],
        operatives: Object.fromEntries(OPERATIVE_MODELS.map((m) => [m, []])),
        rawQueries: 0,
    };
}

const clone = (value) => structuredClone(value);
const fkError = () => Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
const notFound = () => Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });

function matchStatus(row, cond) {
    if (cond === undefined) return true;
    if (typeof cond === "object" && cond?.in) return cond.in.includes(row.status);
    return row.status === cond;
}

function eventIdsOfOrganization(organizationId) {
    return new Set(db.events.filter((e) => e.organizationId === organizationId).map((e) => e.id));
}

function organizationHasDependents(organizationId) {
    return (
        db.events.some((e) => e.organizationId === organizationId) ||
        db.withdrawals.some((w) => w.organizationId === organizationId) ||
        OPERATIVE_MODELS.filter((m) => m !== "conversationState").some((m) => db.operatives[m].some((r) => r.organizationId === organizationId))
    );
}

function withOwner(organization) {
    const owner = db.users.find((u) => u.id === organization.ownerId);
    return { ...clone(organization), owner: owner ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, email: owner.email } : null };
}

Object.assign(prisma.user, {
    findUnique: async ({ where }) => clone(db.users.find((u) => (where.id ? u.id === where.id : u.clerkId === where.clerkId)) ?? null),
    update: async ({ where, data }) => {
        const user = db.users.find((u) => u.id === where.id);
        Object.assign(user, data);
        return clone(user);
    },
});

Object.assign(prisma.organization, {
    findFirst: async ({ where }) =>
        clone(db.organizations.find((o) => o.ownerId === where.ownerId && (where.closedAt !== null || o.closedAt === null)) ?? null),
    findUnique: async ({ where, include }) => {
        const org = db.organizations.find((o) => (where.id ? o.id === where.id : o.slug === where.slug));
        if (!org) return null;
        return include?.owner ? withOwner(org) : clone(org);
    },
    findMany: async ({ where = {} } = {}) =>
        db.organizations
            .filter((o) => !where.status || o.status === where.status)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(withOwner),
    count: async ({ where }) => db.organizations.filter((o) => o.ownerId === where.ownerId).length,
    create: async ({ data }) => {
        const org = { id: nextId("org"), createdAt: new Date(), closedAt: null, plan: "FREE", approvedAt: null, ...data };
        db.organizations.push(org);
        return clone(org);
    },
    update: async ({ where, data }) => {
        const org = db.organizations.find((o) => o.id === where.id);
        Object.assign(org, data);
        return clone(org);
    },
    delete: async ({ where }) => {
        const index = db.organizations.findIndex((o) => o.id === where.id);
        if (index === -1) throw notFound();
        if (organizationHasDependents(where.id)) throw fkError();
        const [removed] = db.organizations.splice(index, 1);
        return removed;
    },
});

Object.assign(prisma.deletedOrganization, {
    create: async ({ data }) => {
        const row = { id: nextId("deleted"), ...data };
        db.deletedOrganizations.push(row);
        return clone(row);
    },
    findMany: async () => clone(db.deletedOrganizations).sort((a, b) => b.originalCreatedAt - a.originalCreatedAt),
});

Object.assign(prisma.sale, {
    count: async ({ where }) => {
        const eventIds = eventIdsOfOrganization(where.event.organizationId);
        return db.sales.filter((s) => eventIds.has(s.eventId) && matchStatus(s, where.status) && s.deletedAt === null).length;
    },
});

Object.assign(prisma.eventFunction, {
    findMany: async ({ where }) => {
        const eventIds = eventIdsOfOrganization(where.event.organizationId);
        const isActive = (t) => t.status === "ACTIVE" && t.deletedAt === null;
        return db.functions
            .filter((fn) => eventIds.has(fn.eventId) && db.tickets.some((t) => t.functionId === fn.id && isActive(t)))
            .map((fn) => ({ ...clone(fn), _count: { tickets: db.tickets.filter((t) => t.functionId === fn.id && isActive(t)).length } }));
    },
});

Object.assign(prisma.withdrawalRequest, {
    count: async ({ where }) => db.withdrawals.filter((w) => w.organizationId === where.organizationId && matchStatus(w, where.status)).length,
    updateMany: async ({ where, data }) => {
        const rows = db.withdrawals.filter((w) => w.organizationId === where.organizationId);
        rows.forEach((w) => Object.assign(w, data));
        return { count: rows.length };
    },
});

Object.assign(prisma.event, {
    findMany: async ({ where }) =>
        db.events
            .filter((e) => e.organizationId === where.organizationId)
            .map((e) => ({
                id: e.id,
                _count: {
                    sales: db.sales.filter((s) => s.eventId === e.id).length,
                    tickets: db.tickets.filter((t) => t.eventId === e.id).length,
                    withdrawalRequests: db.withdrawals.filter((w) => w.eventId === e.id).length,
                },
            })),
    deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        // RESTRICT reales: Sale/Ticket/WithdrawalRequest -> Event.
        if (db.sales.some((s) => ids.has(s.eventId)) || db.tickets.some((t) => ids.has(t.eventId)) || db.withdrawals.some((w) => ids.has(w.eventId))) {
            throw fkError();
        }
        const before = db.events.length;
        db.events = db.events.filter((e) => !ids.has(e.id));
        // CASCADE reales: EventFunction, EventScanner (y links/tipos).
        db.functions = db.functions.filter((fn) => !ids.has(fn.eventId));
        db.scanners = db.scanners.filter((sc) => !ids.has(sc.eventId));
        return { count: before - db.events.length };
    },
    updateMany: async ({ where, data }) => {
        const ids = new Set(where.id.in);
        const rows = db.events.filter((e) => ids.has(e.id) && (where.archivedAt !== null || e.archivedAt === null));
        rows.forEach((e) => Object.assign(e, data));
        return { count: rows.length };
    },
});

Object.assign(prisma.eventScanner, {
    updateMany: async ({ where, data }) => {
        const ids = new Set(where.eventId.in);
        const rows = db.scanners.filter((sc) => ids.has(sc.eventId) && sc.deletedAt === null);
        rows.forEach((sc) => Object.assign(sc, data));
        return { count: rows.length };
    },
});

for (const model of OPERATIVE_MODELS) {
    prisma[model].deleteMany = async ({ where }) => {
        const before = db.operatives[model].length;
        db.operatives[model] = db.operatives[model].filter((r) => r.organizationId !== where.organizationId);
        return { count: before - db.operatives[model].length };
    };
}

prisma.whatsappPendingOrganizationSelection.deleteMany = async ({ where }) => {
    const [bySelected, byCandidate] = where.OR;
    const id = bySelected.selectedOrganizationId;
    assert.deepEqual(byCandidate.candidateOrganizationIds.array_contains, [id]);
    const before = db.pendingSelections.length;
    db.pendingSelections = db.pendingSelections.filter((p) => p.selectedOrganizationId !== id && !p.candidateOrganizationIds.includes(id));
    return { count: before - db.pendingSelections.length };
};

prisma.$queryRaw = async () => {
    db.rawQueries += 1;
    return [];
};

prisma.$transaction = async (fn) => {
    const snapshot = clone(db);
    try {
        return await fn(prisma);
    } catch (err) {
        db = snapshot;
        throw err;
    }
};

// --- Fixtures ----------------------------------------------------------------

function addOwner({ role = "ORGANIZER" } = {}) {
    const user = { id: nextId("user"), clerkId: `clerk_${seq}`, email: `owner${seq}@example.com`, firstName: "Ezequiel", lastName: "Maureira", role };
    db.users.push(user);
    return user;
}

function addOrganization(owner, overrides = {}) {
    const org = {
        id: nextId("org"),
        name: "Prueba organizador",
        slug: `prueba-${seq}`,
        email: "org@example.com",
        logo: "https://example.com/logo.png",
        type: "TEATRO",
        city: "Córdoba",
        province: "Córdoba",
        responsibleFirstName: "Ezequiel",
        responsibleLastName: "Maureira",
        status: "APPROVED",
        plan: "PREMIUM",
        createdAt: new Date("2026-10-05T12:00:00Z"),
        approvedAt: new Date("2026-10-05T13:00:00Z"),
        closedAt: null,
        ownerId: owner.id,
        ...overrides,
    };
    db.organizations.push(org);
    return org;
}

function addEvent(organization, { functionOffsetMs = 7 * DAY } = {}) {
    const event = { id: nextId("event"), organizationId: organization.id, deletedOrganizationId: null, archivedAt: null, status: "PUBLISHED", title: `Evento ${seq}` };
    const fn = { id: nextId("fn"), eventId: event.id, date: new Date(Date.now() + functionOffsetMs), doorsOpenAt: null, endAt: null, status: "SCHEDULED" };
    db.events.push(event);
    db.functions.push(fn);
    db.scanners.push({ id: nextId("scanner"), eventId: event.id, deletedAt: null });
    return { event, fn };
}

function addSale({ event, fn }, { status = "CONFIRMED", ticketStatus = "ACTIVE", tickets = 1 } = {}) {
    const sale = { id: nextId("sale"), eventId: event.id, functionId: fn.id, status, deletedAt: null };
    db.sales.push(sale);
    for (let i = 0; i < tickets; i++) {
        db.tickets.push({ id: nextId("ticket"), saleId: sale.id, eventId: event.id, functionId: fn.id, status: ticketStatus, deletedAt: null });
    }
    return sale;
}

function addOperativeRows(organization) {
    for (const model of OPERATIVE_MODELS) db.operatives[model].push({ id: nextId(model), organizationId: organization.id });
    db.pendingSelections.push({ id: nextId("sel"), selectedOrganizationId: null, candidateOrganizationIds: [organization.id, "otra-org"] });
}

const deleteOwn = (owner) => deleteMyOrganizationService(owner.clerkId, { confirmation: "ELIMINAR" });

test.beforeEach(() => resetDb());

// --- Escenarios --------------------------------------------------------------

test("confirmación incorrecta => 400 y nada cambia", async () => {
    const owner = addOwner();
    addOrganization(owner);
    await assert.rejects(
        deleteMyOrganizationService(owner.clerkId, { confirmation: "eliminar" }),
        (err) => err.code === "ORGANIZATION_DELETE_CONFIRMATION_REQUIRED" && err.httpStatus === 400
    );
    assert.equal(db.organizations.length, 1);
});

test("organización sin eventos => hard delete, antecedente completo, limpieza operativa, User conservado como CUSTOMER", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    addOperativeRows(org);

    const result = await deleteOwn(owner);

    assert.equal(result.mode, "deleted");
    assert.equal(db.organizations.length, 0, "la Organization se borra físicamente");
    assert.equal(db.deletedOrganizations.length, 1);
    const snapshot = db.deletedOrganizations[0];
    assert.equal(snapshot.originalOrganizationId, org.id);
    assert.equal(snapshot.name, "Prueba organizador");
    assert.equal(snapshot.logo, org.logo);
    assert.equal(snapshot.email, org.email);
    assert.equal(snapshot.plan, "PREMIUM");
    assert.equal(snapshot.responsibleFirstName, "Ezequiel");
    assert.equal(snapshot.ownerId, owner.id);
    assert.equal(snapshot.ownerEmail, owner.email);
    assert.equal(snapshot.originalCreatedAt.toISOString(), org.createdAt.toISOString());
    assert.equal(snapshot.originalStatus, "APPROVED");
    assert.equal(snapshot.reason, "DELETED_BY_USER");
    assert.ok(snapshot.deletedAt instanceof Date);

    for (const model of OPERATIVE_MODELS) assert.equal(db.operatives[model].length, 0, `${model} limpio`);
    assert.equal(db.pendingSelections.length, 0);
    assert.equal(db.rawQueries, 2, "lock de Organization + eventos");

    const user = db.users.find((u) => u.id === owner.id);
    assert.ok(user, "el User se conserva");
    assert.equal(user.clerkId, owner.clerkId, "Clerk intacto");
    assert.equal(user.role, "CUSTOMER");
    assert.equal(await getMyOrganizationService(owner.clerkId), null);
});

test("organización con eventos SIN ventas => los eventos se borran (cascade de funciones y scanners)", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    addEvent(org);
    addEvent(org, { functionOffsetMs: -3 * DAY });

    await deleteOwn(owner);

    assert.equal(db.events.length, 0);
    assert.equal(db.functions.length, 0);
    assert.equal(db.scanners.length, 0);
    assert.equal(db.organizations.length, 0);
});

test("evento histórico con ventas/tickets => se conserva desacoplado y ARCHIVADO, ventas y tickets intactos", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    const past = addEvent(org, { functionOffsetMs: -3 * DAY });
    const sale = addSale(past, { tickets: 2 });
    db.tickets[1].status = "USED";
    const cancelledSaleEvent = addEvent(org, { functionOffsetMs: -10 * DAY });
    addSale(cancelledSaleEvent, { status: "CANCELLED", ticketStatus: "CANCELLED" });
    const salesBefore = clone(db.sales);
    const ticketsBefore = clone(db.tickets);
    const empty = addEvent(org);

    const result = await deleteOwn(owner);
    const snapshot = db.deletedOrganizations[0];

    assert.deepEqual(result.mode, "deleted");
    assert.equal(db.organizations.length, 0);
    assert.ok(!db.events.some((e) => e.id === empty.event.id), "el evento vacío se borra");
    for (const kept of [past.event, cancelledSaleEvent.event]) {
        const event = db.events.find((e) => e.id === kept.id);
        assert.ok(event, "el evento con historial se conserva");
        assert.equal(event.organizationId, null);
        assert.equal(event.deletedOrganizationId, snapshot.id);
        assert.ok(event.archivedAt instanceof Date, "queda archivado");
        assert.equal(event.status, "PUBLISHED", "nunca se reutiliza CANCELLED");
    }
    assert.deepEqual(db.sales, salesBefore, "ninguna Sale se modifica");
    assert.deepEqual(db.tickets, ticketsBefore, "ningún Ticket se modifica");
    assert.ok(db.functions.some((fn) => fn.id === past.fn.id), "la función del evento histórico se conserva");
    assert.ok(
        db.scanners.filter((sc) => sc.eventId === past.event.id).every((sc) => sc.deletedAt instanceof Date),
        "los scanners del evento histórico pierden acceso"
    );
    assert.equal(resolveEventOrganization({ organization: null, deletedOrganization: { id: snapshot.id, name: snapshot.name } }).name, "Prueba organizador");
    assert.ok(sale);
});

test("venta PENDING => 409 ORGANIZATION_DELETE_BLOCKED, rollback total", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    addOperativeRows(org);
    const past = addEvent(org, { functionOffsetMs: -3 * DAY });
    addSale(past, { status: "PENDING", tickets: 0 });
    const before = clone(db);

    await assert.rejects(deleteOwn(owner), (err) => {
        assert.equal(err.code, "ORGANIZATION_DELETE_BLOCKED");
        assert.equal(err.httpStatus, 409);
        assert.deepEqual(err.details.map((b) => [b.code, b.count]), [["PENDING_SALES", 1]]);
        assert.match(err.details[0].message, /pendiente/);
        return true;
    });

    assert.deepEqual({ ...db, rawQueries: 0 }, { ...before, rawQueries: 0 }, "nada cambió");
    assert.equal(db.users.find((u) => u.id === owner.id).role, "ORGANIZER");
});

test("función futura con tickets ACTIVE => bloquea; una vez resueltas esas entradas, permite eliminar", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    const future = addEvent(org, { functionOffsetMs: 2 * DAY });
    addSale(future, { tickets: 3 });

    await assert.rejects(deleteOwn(owner), (err) => {
        assert.deepEqual(err.details.map((b) => [b.code, b.count]), [["UPCOMING_ACTIVE_TICKETS", 3]]);
        return true;
    });
    assert.equal(db.organizations.length, 1);
    assert.equal(db.deletedOrganizations.length, 0);

    // Las entradas se cancelan (resuelto por el organizador) => ya no bloquea.
    db.tickets.forEach((t) => (t.status = "CANCELLED"));
    await deleteOwn(owner);
    assert.equal(db.organizations.length, 0);
    assert.equal(db.events[0].organizationId, null);
});

test("solicitud de arrepentimiento abierta => bloquea; resuelta => se conserva apuntando al antecedente", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    const past = addEvent(org, { functionOffsetMs: -3 * DAY });
    const sale = addSale(past);
    db.tickets[0].status = "USED";
    db.withdrawals.push({ id: nextId("wr"), saleId: sale.id, eventId: past.event.id, organizationId: org.id, deletedOrganizationId: null, status: "REQUESTED" });

    await assert.rejects(deleteOwn(owner), (err) => err.details.some((b) => b.code === "OPEN_WITHDRAWAL_REQUESTS"));

    db.withdrawals[0].status = "RESOLVED";
    await deleteOwn(owner);
    assert.equal(db.withdrawals.length, 1);
    assert.equal(db.withdrawals[0].organizationId, null);
    assert.equal(db.withdrawals[0].deletedOrganizationId, db.deletedOrganizations[0].id);
});

test("si algo falla a mitad de camino, la transacción no deja estados parciales", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    const past = addEvent(org, { functionOffsetMs: -3 * DAY });
    addSale(past);
    db.tickets[0].status = "USED";
    const before = clone(db);
    const original = prisma.organization.delete;
    prisma.organization.delete = async () => {
        throw new Error("boom");
    };
    try {
        await assert.rejects(deleteOwn(owner), /boom/);
    } finally {
        prisma.organization.delete = original;
    }
    assert.deepEqual({ ...db, rawQueries: 0 }, { ...before, rawQueries: 0 });
});

test("después de eliminar, el mismo usuario puede crear una organización nueva", async () => {
    const owner = addOwner();
    addOrganization(owner);
    await deleteOwn(owner);

    const { organization, user } = await createOrganizationService(owner.clerkId, { name: "Nueva sala", email: "nueva@example.com" });

    assert.equal(organization.status, "PENDING");
    assert.equal(organization.ownerId, owner.id);
    assert.equal(user.role, "ORGANIZER");
    assert.equal((await getMyOrganizationService(owner.clerkId)).id, organization.id);
    assert.equal(db.deletedOrganizations.length, 1, "el antecedente no cuenta como organización");
});

test("Developer: la fila eliminada aparece en Todas como DELETED_BY_USER y nunca en Suspendidas", async () => {
    const owner = addOwner();
    addOrganization(owner, { name: "Prueba organizador" });
    const otherOwner = addOwner();
    addOrganization(otherOwner, { name: "Suspendida por Developer", status: "SUSPENDED", createdAt: new Date("2026-09-01T00:00:00Z") });
    await deleteOwn(owner);

    const all = await getOrganizationsService();
    assert.deepEqual(all.map((o) => [o.name, o.status, Boolean(o.deleted)]), [
        ["Prueba organizador", "DELETED_BY_USER", true],
        ["Suspendida por Developer", "SUSPENDED", false],
    ]);
    const deletedRow = all[0];
    assert.equal(deletedRow.plan, "PREMIUM");
    assert.equal(deletedRow.email, "org@example.com");
    assert.equal(deletedRow.createdAt.toISOString(), "2026-10-05T12:00:00.000Z", "fecha de registro original");
    assert.ok(deletedRow.deletedAt);
    assert.equal(deletedRow.owner.email, owner.email);

    const suspended = await getOrganizationsService("SUSPENDED");
    assert.deepEqual(suspended.map((o) => o.name), ["Suspendida por Developer"]);
});

test("Developer: cambiar estado/plan de una DeletedOrganization => 404, y nada cambia", async () => {
    const owner = addOwner();
    addOrganization(owner);
    await deleteOwn(owner);
    const deletedId = db.deletedOrganizations[0].id;

    assert.equal(await updateOrganizationStatusService(deletedId, "APPROVED", "dev-1"), null);
    assert.equal(await updateOrganizationPlanService(deletedId, "FREE", "dev-1"), null);

    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await updateOrganizationStatus({ params: { id: deletedId }, body: { status: "APPROVED" }, dbUser: { id: "dev-1" } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(db.organizations.length, 0);
    assert.equal(db.deletedOrganizations[0].reason, "DELETED_BY_USER");
});

test("Developer: una organización cerrada con el mecanismo viejo (closedAt) ya no puede reactivarse", async () => {
    const owner = addOwner({ role: "CUSTOMER" });
    const legacy = addOrganization(owner, { status: "SUSPENDED", closedAt: new Date("2026-10-06T00:00:00Z") });
    assert.equal(await updateOrganizationStatusService(legacy.id, "APPROVED", "dev-1"), null);
    assert.equal(db.organizations[0].status, "SUSPENDED");
});

test("Developer hard delete con datos asociados => 409 controlado (nunca 500), sin borrar nada", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    addEvent(org);

    await assert.rejects(deleteOrganizationService(org.id), (err) => err.code === "ORGANIZATION_HAS_RELATED_DATA" && err.httpStatus === 409);
    assert.equal(db.organizations.length, 1);
    assert.equal(db.events.length, 1);

    const empty = addOrganization(addOwner());
    await deleteOrganizationService(empty.id);
    assert.ok(!db.organizations.some((o) => o.id === empty.id));

    // Forma real con FK RESTRICT en Postgres: SQLSTATE 23001 envuelto en
    // PrismaClientUnknownRequestError, sin `code` (verificado contra Postgres).
    const original = prisma.organization.delete;
    prisma.organization.delete = async () => {
        throw new Error('update or delete on table "Organization" violates RESTRICT setting of foreign key constraint "Event_organizationId_fkey" on table "Event" (23001)');
    };
    try {
        await assert.rejects(deleteOrganizationService(org.id), (err) => err.code === "ORGANIZATION_HAS_RELATED_DATA");
    } finally {
        prisma.organization.delete = original;
    }
});

test("respuesta HTTP del bloqueo: 409 con la lista de motivos en error.errors", async () => {
    const owner = addOwner();
    const org = addOrganization(owner);
    addSale(addEvent(org), { status: "PENDING", tickets: 0 });
    const err = await deleteOwn(owner).catch((e) => e);

    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    errorHandler(err, { method: "DELETE", originalUrl: "/api/organizations/me" }, res, () => {});
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, "ORGANIZATION_DELETE_BLOCKED");
    assert.equal(res.body.error.errors[0].code, "PENDING_SALES");
    assert.ok(res.body.message);
});

// --- Null-safety: un evento histórico desacoplado nunca vuelve a operar ----

const DETACHED_EVENT = { id: "event-detached", organizationId: null, deletedOrganizationId: "deleted-x", archivedAt: new Date(), admissionType: "TICKETED", title: "Show pasado" };

test("evento desacoplado: no se puede vender, ni emitir cortesía, ni abrir checkout de Mercado Pago", async () => {
    const original = prisma.event.findUnique;
    prisma.event.findUnique = async ({ include }) => ({ ...DETACHED_EVENT, ...(include?.organization ? { organization: null } : {}) });
    try {
        await assert.rejects(createSaleForBuyer({ id: "buyer" }, { eventId: DETACHED_EVENT.id }, { origin: "COURTESY" }), (err) => err.code === "EVENT_NOT_FOUND");
        await assert.rejects(createMercadoPagoCheckoutService({}, { eventId: DETACHED_EVENT.id }, null), (err) => err.code === "EVENT_NOT_FOUND");
    } finally {
        prisma.event.findUnique = original;
    }
});

test("evento desacoplado: no admite nueva solicitud de arrepentimiento ni expone contacto", async () => {
    assert.deepEqual(buildOrganizationContact(null, "Show pasado"), { whatsappUrl: null, email: null });
    const original = prisma.sale.findUnique;
    prisma.sale.findUnique = async () => ({
        id: "sale-1",
        deletedAt: null,
        status: "CONFIRMED",
        origin: "SALE",
        eventId: DETACHED_EVENT.id,
        event: { ...DETACHED_EVENT, organization: null },
        tickets: [{ status: "USED" }],
        items: [],
    });
    try {
        await assert.rejects(createWithdrawalRequestService("token-1", {}), (err) => err.code === "WITHDRAWAL_REQUEST_NOT_ELIGIBLE");
    } finally {
        prisma.sale.findUnique = original;
    }
});

test("reconciliación Mercado Pago: un evento sin organización no tiene conexiones candidatas (sin query inválida)", async () => {
    assert.deepEqual(await listCandidateConnectionsForOrganization(null), []);
});
