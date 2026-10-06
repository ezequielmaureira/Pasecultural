import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import prisma from "../src/config/prisma.js";
import app from "../src/app.js";
import { syncUserService } from "../src/services/auth.service.js";

// Suspensión de usuarios: Clerk prueba la identidad, User.status decide la
// autorización. Se ejercita la app Express REAL (rutas + requireAuth/
// requireRole + errorHandler) contra Postgres de test — nunca mocks de
// Prisma, ver tests/helpers/dbGuard.js. Clerk nunca se llama: un wrapper
// instala un `req.auth` con la misma marca que pone clerkMiddleware, que
// entonces no vuelve a autenticar (ver @clerk/express#requestHasAuthObject).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

function fakeClerkAuth(clerkId) {
    const authObject = clerkId
        ? { userId: clerkId, tokenType: "session_token", isAuthenticated: true }
        : { userId: null, tokenType: "session_token", isAuthenticated: false };
    return Object.assign(() => authObject, { [CLERK_AUTH_BRAND]: true });
}

let server;
let baseUrl;

test.before(async () => {
    if (!hasDatabase) return;
    const harness = express();
    harness.use((req, res, next) => {
        req.auth = fakeClerkAuth(req.headers["x-test-clerk-id"] || null);
        next();
    });
    harness.use(app);
    await new Promise((resolve) => {
        server = harness.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { clerkId, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(clerkId ? { "x-test-clerk-id": clerkId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try {
        json = await res.json();
    } catch {
        // sin body JSON
    }
    return { status: res.status, body: json };
}

async function createUser({ role = "CUSTOMER", status = "ACTIVE" } = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_susp_${suffix}`,
            email: `suspension_${suffix}@example.com`,
            firstName: "Persona",
            lastName: `Test${suffix}`,
            role,
            status,
        },
    });
}

async function createOrganizer({ status = "ACTIVE" } = {}) {
    const user = await createUser({ role: "ORGANIZER", status });
    const suffix = uniqueSuffix();
    const organization = await prisma.organization.create({
        data: {
            name: `Sala Susp ${suffix}`,
            slug: `sala-susp-${suffix}`,
            email: `org_susp_${suffix}@example.com`,
            status: "APPROVED",
            ownerId: user.id,
        },
    });
    return { user, organization };
}

function assertSuspended(res) {
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "USER_SUSPENDED");
    assert.match(res.body?.message ?? "", /suspendido/);
}

testWithDb("ACTIVE + sesión Clerk válida → acceso permitido (requireAuth y requireRole)", async () => {
    const customer = await createUser();
    const res = await call("GET", "/api/sales/mine", { clerkId: customer.clerkId });
    assert.equal(res.status, 200);

    const { user: organizer } = await createOrganizer();
    const org = await call("GET", "/api/organizations/me", { clerkId: organizer.clerkId });
    assert.equal(org.status, 200);
    assert.ok(org.body.organization);
    const settings = await call("GET", "/api/organizer/notification-settings", { clerkId: organizer.clerkId });
    assert.equal(settings.status, 200);
});

testWithDb("CUSTOMER SUSPENDED + sesión Clerk válida → 403 USER_SUSPENDED", async () => {
    const customer = await createUser({ status: "SUSPENDED" });
    assertSuspended(await call("GET", "/api/sales/mine", { clerkId: customer.clerkId }));
    assertSuspended(await call("POST", "/api/conversations/start", { clerkId: customer.clerkId, body: {} }));
    assertSuspended(await call("DELETE", "/api/auth/me", { clerkId: customer.clerkId, body: { confirmation: "ELIMINAR" } }));
    // Un CUSTOMER suspendido tampoco puede crear una organización (antes
    // POST /api/organizations no tenía middleware y saltaba la suspensión).
    assertSuspended(
        await call("POST", "/api/organizations", {
            clerkId: customer.clerkId,
            body: { name: "Intento", email: "x@example.com" },
        })
    );
    const unchanged = await prisma.organization.count({ where: { ownerId: customer.id } });
    assert.equal(unchanged, 0);
});

testWithDb("ORGANIZER SUSPENDED con rol correcto → igualmente bloqueado (requireRole no permite saltarla)", async () => {
    const { user: organizer, organization } = await createOrganizer({ status: "SUSPENDED" });
    const id = organizer.clerkId;

    // requireRole("ORGANIZER")
    assertSuspended(await call("GET", "/api/organizer/notification-settings", { clerkId: id }));
    assertSuspended(await call("GET", "/api/sales", { clerkId: id }));
    assertSuspended(await call("GET", "/api/tickets/organizer", { clerkId: id }));
    assertSuspended(await call("GET", "/api/courtesies", { clerkId: id }));
    // requireAuth
    assertSuspended(await call("GET", "/api/events/mine", { clerkId: id }));
    assertSuspended(await call("POST", "/api/events", { clerkId: id, body: { title: "x" } }));
    // Rutas /organizations/me que antes usaban getAuth directo sin middleware
    assertSuspended(await call("GET", "/api/organizations/me", { clerkId: id }));
    assertSuspended(await call("PATCH", "/api/organizations/me", { clerkId: id, body: { name: "Hackeada" } }));
    assertSuspended(await call("DELETE", "/api/organizations/me", { clerkId: id, body: { confirmation: "ELIMINAR" } }));

    const after = await prisma.organization.findUnique({ where: { id: organization.id } });
    assert.equal(after.name, organization.name);
    assert.equal(after.closedAt, null);
});

testWithDb("SUSPENDED sin el rol pedido → USER_SUSPENDED (no el 403 genérico de rol)", async () => {
    const customer = await createUser({ status: "SUSPENDED" });
    assertSuspended(await call("GET", "/api/users", { clerkId: customer.clerkId }));
});

testWithDb("DEVELOPER SUSPENDED → bloqueado en endpoints Developer", async () => {
    const developer = await createUser({ role: "DEVELOPER", status: "SUSPENDED" });
    assertSuspended(await call("GET", "/api/users", { clerkId: developer.clerkId }));
    assertSuspended(await call("GET", "/api/developer/dashboard", { clerkId: developer.clerkId }));
});

testWithDb("suspender y reactivar desde Developer: bloquea y después devuelve el acceso sin perder datos", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const { user: organizer, organization } = await createOrganizer();

    const suspend = await call("PATCH", `/api/users/${organizer.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "SUSPENDED" },
    });
    assert.equal(suspend.status, 200);
    assert.equal(suspend.body.user.status, "SUSPENDED");
    assertSuspended(await call("GET", "/api/organizations/me", { clerkId: organizer.clerkId }));

    const reactivate = await call("PATCH", `/api/users/${organizer.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "ACTIVE" },
    });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.user.status, "ACTIVE");

    const org = await call("GET", "/api/organizations/me", { clerkId: organizer.clerkId });
    assert.equal(org.status, 200);
    assert.equal(org.body.organization.id, organization.id);
    const settings = await call("GET", "/api/organizer/notification-settings", { clerkId: organizer.clerkId });
    assert.equal(settings.status, 200);

    const reloaded = await prisma.user.findUnique({ where: { id: organizer.id } });
    assert.equal(reloaded.clerkId, organizer.clerkId);
    assert.equal(reloaded.role, "ORGANIZER");
});

testWithDb("Developer no puede suspenderse a sí mismo (protección existente)", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const res = await call("PATCH", `/api/users/${developer.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "SUSPENDED" },
    });
    assert.equal(res.status, 400);
    const reloaded = await prisma.user.findUnique({ where: { id: developer.id } });
    assert.equal(reloaded.status, "ACTIVE");
});

testWithDb("/auth/sync (syncUserService) informa el status para que el frontend detecte SUSPENDED", async () => {
    const suspended = await createUser({ role: "ORGANIZER", status: "SUSPENDED" });
    const synced = await syncUserService({
        clerkId: suspended.clerkId,
        email: suspended.email,
        firstName: suspended.firstName,
        lastName: suspended.lastName,
        imageUrl: null,
    });
    assert.equal(synced.status, "SUSPENDED");
    assert.equal(synced.role, "ORGANIZER");

    const active = await createUser();
    const syncedActive = await syncUserService({
        clerkId: active.clerkId,
        email: active.email,
        firstName: active.firstName,
        lastName: active.lastName,
        imageUrl: null,
    });
    assert.equal(syncedActive.status, "ACTIVE");

    // Sync no modifica el status (la suspensión sólo cambia desde Developer).
    const reloaded = await prisma.user.findUnique({ where: { id: suspended.id } });
    assert.equal(reloaded.status, "SUSPENDED");
});

testWithDb("sin sesión Clerk → 401 en rutas autenticadas (sin cambios)", async () => {
    const res = await call("GET", "/api/sales/mine");
    assert.equal(res.status, 401);
    const org = await call("GET", "/api/organizations/me");
    assert.equal(org.status, 401);
});

testWithDb("rutas públicas siguen funcionando, con o sin sesión suspendida", async () => {
    const suspended = await createUser({ status: "SUSPENDED" });
    for (const clerkId of [undefined, suspended.clerkId]) {
        assert.equal((await call("GET", "/api/health", { clerkId })).status, 200);
        assert.equal((await call("GET", "/api/events/categories", { clerkId })).status, 200);
        assert.equal((await call("GET", "/api/public/launch-status", { clerkId })).status, 200);
        assert.equal((await call("GET", "/api/sales/service-fee-tiers", { clerkId })).status, 200);
    }
});
