import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Suspensión de usuarios — versión SIN base de datos de
// userSuspension.test.js. DATABASE_URL/DIRECT_URL apuntan a un puerto local
// cerrado ANTES de importar Prisma (dotenv nunca pisa una variable ya
// definida), y prisma.user.findUnique/update se reemplazan por un store en
// memoria: si alguna ruta llegara a hacer una query real, falla contra
// 127.0.0.1:1 — nunca contra una base real.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { default: prisma } = await import("../src/config/prisma.js");
const { default: app } = await import("../src/app.js");
const { requireAuth } = await import("../src/middlewares/requireAuth.js");
const { requireRole } = await import("../src/middlewares/requireRole.js");

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

const users = new Map();

function pick(user, select) {
    if (!user || !select) return user ?? null;
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, user[k]]));
}

prisma.user.findUnique = async ({ where, select }) => {
    const found = [...users.values()].find((u) =>
        where.id !== undefined ? u.id === where.id : u.clerkId === where.clerkId
    );
    return pick(found ? { ...found } : null, select);
};

prisma.user.update = async ({ where, data, select }) => {
    const user = users.get(where.id);
    if (!user) throw Object.assign(new Error("not found"), { code: "P2025" });
    Object.assign(user, data);
    return pick({ ...user }, select);
};

let seq = 0;
function addUser({ role = "CUSTOMER", status = "ACTIVE" } = {}) {
    seq += 1;
    const user = {
        id: `user-${seq}`,
        clerkId: `clerk_${seq}`,
        email: `u${seq}@example.com`,
        firstName: "Persona",
        lastName: `Test${seq}`,
        imageUrl: null,
        role,
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    users.set(user.id, user);
    return user;
}

function fakeClerkAuth(clerkId) {
    const authObject = clerkId
        ? { userId: clerkId, tokenType: "session_token", isAuthenticated: true }
        : { userId: null, tokenType: "session_token", isAuthenticated: false };
    return Object.assign(() => authObject, { [CLERK_AUTH_BRAND]: true });
}

// --- Middlewares aislados ---------------------------------------------

async function runMiddleware(middleware, clerkId) {
    const req = { auth: fakeClerkAuth(clerkId) };
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    let nextArg = "not-called";
    await middleware(req, res, (arg) => {
        nextArg = arg;
    });
    return { req, res, nextArg };
}

function assertNextOk({ nextArg, res }) {
    assert.equal(nextArg, undefined, "next() debe llamarse sin error");
    assert.equal(res.statusCode, null);
}

function assertNextSuspended({ nextArg }) {
    assert.equal(nextArg?.name, "AppError");
    assert.equal(nextArg.code, "USER_SUSPENDED");
    assert.equal(nextArg.httpStatus, 403);
}

test("requireAuth: ACTIVE + Clerk válido → next()", async () => {
    const user = addUser();
    assertNextOk(await runMiddleware(requireAuth, user.clerkId));
});

test("requireAuth: SUSPENDED + Clerk válido → USER_SUSPENDED (CUSTOMER y ORGANIZER)", async () => {
    assertNextSuspended(await runMiddleware(requireAuth, addUser({ status: "SUSPENDED" }).clerkId));
    assertNextSuspended(await runMiddleware(requireAuth, addUser({ role: "ORGANIZER", status: "SUSPENDED" }).clerkId));
});

test("requireAuth: Clerk sin User interno todavía (pre-sync) → next(), comportamiento previo", async () => {
    assertNextOk(await runMiddleware(requireAuth, "clerk_sin_sync"));
});

test("requireAuth: sin sesión → 401", async () => {
    const { res, nextArg } = await runMiddleware(requireAuth, null);
    assert.equal(res.statusCode, 401);
    assert.equal(nextArg, "not-called");
});

test("requireRole: ORGANIZER ACTIVE → next() con req.dbUser", async () => {
    const user = addUser({ role: "ORGANIZER" });
    const result = await runMiddleware(requireRole("ORGANIZER"), user.clerkId);
    assertNextOk(result);
    assert.equal(result.req.dbUser.id, user.id);
});

test("requireRole: SUSPENDED con el rol correcto → USER_SUSPENDED, no se salta la suspensión", async () => {
    const organizer = addUser({ role: "ORGANIZER", status: "SUSPENDED" });
    const result = await runMiddleware(requireRole("ORGANIZER", "DEVELOPER"), organizer.clerkId);
    assertNextSuspended(result);
    assert.equal(result.req.dbUser, undefined);
    assertNextSuspended(await runMiddleware(requireRole("DEVELOPER"), addUser({ role: "DEVELOPER", status: "SUSPENDED" }).clerkId));
});

test("requireRole: SUSPENDED sin el rol → USER_SUSPENDED (no el 403 genérico)", async () => {
    assertNextSuspended(await runMiddleware(requireRole("DEVELOPER"), addUser({ status: "SUSPENDED" }).clerkId));
});

test("requireRole: ACTIVE sin el rol → 403 de permisos como antes", async () => {
    const { res, nextArg } = await runMiddleware(requireRole("DEVELOPER"), addUser().clerkId);
    assert.equal(res.statusCode, 403);
    assert.equal(nextArg, "not-called");
});

test("reactivado → requireAuth y requireRole vuelven a dejar pasar", async () => {
    const user = addUser({ role: "ORGANIZER", status: "SUSPENDED" });
    assertNextSuspended(await runMiddleware(requireAuth, user.clerkId));
    users.get(user.id).status = "ACTIVE";
    assertNextOk(await runMiddleware(requireAuth, user.clerkId));
    assertNextOk(await runMiddleware(requireRole("ORGANIZER"), user.clerkId));
});

// --- App Express real (requests directos, sin frontend) -------------------

let server;
let baseUrl;

test.before(async () => {
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

function assertSuspended(res, label) {
    assert.equal(res.status, 403, `${label}: status`);
    assert.equal(res.body?.error?.code, "USER_SUSPENDED", `${label}: code`);
    assert.match(res.body?.message ?? "", /suspendido/, `${label}: message`);
}

// Una ruta por cada router autenticado con Clerk (requireAuth o requireRole),
// incluidas las 4 de /organizations que antes usaban getAuth sin middleware.
const AUTHENTICATED_ROUTES = [
    ["DELETE", "/api/auth/me"],
    ["GET", "/api/users"],
    ["PATCH", "/api/users/x/status"],
    ["GET", "/api/organizations/me"],
    ["PATCH", "/api/organizations/me"],
    ["DELETE", "/api/organizations/me"],
    ["POST", "/api/organizations"],
    ["GET", "/api/organizations/me/whatsapp-link"],
    ["GET", "/api/organizations/me/mercadopago/status"],
    ["GET", "/api/organizations/me/phone-verification"],
    ["GET", "/api/organizations"],
    ["POST", "/api/media/upload"],
    ["DELETE", "/api/media/some/public-id"],
    ["GET", "/api/events/mine"],
    ["POST", "/api/events"],
    ["GET", "/api/events/archived"],
    ["GET", "/api/events/scanner-events"],
    ["PATCH", "/api/events/x"],
    ["POST", "/api/events/x/tickets/y/cancel"],
    ["POST", "/api/conversations/start"],
    ["POST", "/api/conversations/x/reply"],
    ["GET", "/api/sales/mine"],
    ["GET", "/api/sales"],
    ["POST", "/api/sales/x/confirm"],
    ["POST", "/api/sales/x/cancel"],
    ["POST", "/api/sales/x/resend-confirmation-email"],
    ["GET", "/api/courtesies"],
    ["POST", "/api/courtesies"],
    ["GET", "/api/withdrawal-requests"],
    ["GET", "/api/organizer/notification-settings"],
    ["GET", "/api/tickets/organizer"],
    ["GET", "/api/dev/stats"],
    ["GET", "/api/developer/dashboard"],
    ["GET", "/api/developer/events"],
    ["GET", "/api/developer/tickets"],
    ["GET", "/api/developer/scanners"],
    ["GET", "/api/developer/sales"],
    ["GET", "/api/developer/service-fee"],
    ["GET", "/api/developer/alert-config"],
    ["GET", "/api/developer/launch-status"],
    ["GET", "/api/developer/plan-limits"],
    ["GET", "/api/developer/content/fest-pass-intro"],
    ["GET", "/api/developer/qa-checklist"],
];

test("request directo: SUSPENDED (CUSTOMER, ORGANIZER, DEVELOPER) → 403 USER_SUSPENDED en todas las rutas autenticadas", async () => {
    const suspended = [
        addUser({ role: "CUSTOMER", status: "SUSPENDED" }),
        addUser({ role: "ORGANIZER", status: "SUSPENDED" }),
        addUser({ role: "DEVELOPER", status: "SUSPENDED" }),
    ];
    for (const user of suspended) {
        for (const [method, path] of AUTHENTICATED_ROUTES) {
            const body = method === "GET" ? undefined : { confirmation: "ELIMINAR", status: "ACTIVE", name: "x" };
            assertSuspended(await call(method, path, { clerkId: user.clerkId, body }), `${user.role} ${method} ${path}`);
        }
    }
});

test("request directo: sin sesión → 401 en las rutas que antes usaban getAuth sin middleware", async () => {
    for (const [method, path] of [
        ["GET", "/api/organizations/me"],
        ["PATCH", "/api/organizations/me"],
        ["DELETE", "/api/organizations/me"],
        ["POST", "/api/organizations"],
    ]) {
        assert.equal((await call(method, path, { body: method === "GET" ? undefined : {} })).status, 401, `${method} ${path}`);
    }
});

test("Developer suspende y reactiva por HTTP: el afectado queda bloqueado y luego recupera acceso", async () => {
    const developer = addUser({ role: "DEVELOPER" });
    const target = addUser({ role: "DEVELOPER" });

    assert.equal((await call("GET", `/api/users/${developer.id}`, { clerkId: target.clerkId })).status, 200);

    const suspend = await call("PATCH", `/api/users/${target.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "SUSPENDED" },
    });
    assert.equal(suspend.status, 200);
    assert.equal(suspend.body.user.status, "SUSPENDED");
    assertSuspended(await call("GET", `/api/users/${developer.id}`, { clerkId: target.clerkId }), "tras suspender");

    const reactivate = await call("PATCH", `/api/users/${target.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "ACTIVE" },
    });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.user.status, "ACTIVE");
    assert.equal((await call("GET", `/api/users/${developer.id}`, { clerkId: target.clerkId })).status, 200);

    // Nada más cambió: misma identidad Clerk y mismo rol.
    assert.equal(users.get(target.id).clerkId, target.clerkId);
    assert.equal(users.get(target.id).role, "DEVELOPER");
});

test("Developer no puede suspenderse a sí mismo (protección existente)", async () => {
    const developer = addUser({ role: "DEVELOPER" });
    const res = await call("PATCH", `/api/users/${developer.id}/status`, {
        clerkId: developer.clerkId,
        body: { status: "SUSPENDED" },
    });
    assert.equal(res.status, 400);
    assert.equal(users.get(developer.id).status, "ACTIVE");
});

test("/api/auth/sync no pasa por requireAuth: no hay bloqueo circular", async () => {
    // Sin sesión responde el 401 propio del controller, no USER_SUSPENDED:
    // el endpoint queda disponible para que el frontend resuelva el estado.
    // (El status que devuelve se cubre en userSuspension.test.js con DB.)
    const res = await call("POST", "/api/auth/sync");
    assert.equal(res.status, 401);
});

test("rutas públicas siguen respondiendo con una sesión suspendida", async () => {
    const suspended = addUser({ status: "SUSPENDED" });
    for (const clerkId of [undefined, suspended.clerkId]) {
        assert.equal((await call("GET", "/api/health", { clerkId })).status, 200);
        assert.equal((await call("GET", "/api/events/categories", { clerkId })).status, 200);
    }
});

test("syncUserService (POST /api/auth/sync) devuelve el status del User existente sin modificarlo", async () => {
    const { syncUserService } = await import("../src/services/auth.service.js");
    const suspended = addUser({ role: "ORGANIZER", status: "SUSPENDED" });
    const synced = await syncUserService({ clerkId: suspended.clerkId, email: suspended.email });
    assert.equal(synced.status, "SUSPENDED");
    assert.equal(synced.role, "ORGANIZER");
    assert.equal(users.get(suspended.id).status, "SUSPENDED");

    const active = addUser();
    assert.equal((await syncUserService({ clerkId: active.clerkId, email: active.email })).status, "ACTIVE");
});
