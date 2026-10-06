import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// GET /debug/prisma-user era un endpoint de diagnóstico PÚBLICO que creaba
// un User (debug@test.com) y devolvía stack/errores crudos de Prisma. Fue
// eliminado: este test fija que no vuelva. Sin base de datos —
// DATABASE_URL apunta a un puerto local cerrado antes de importar Prisma,
// así ninguna query accidental llega a una base real.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { default: app } = await import("../src/app.js");

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

let server;
let baseUrl;

test.before(async () => {
    const harness = express();
    // Sesión Clerk vacía con la marca de clerkMiddleware, para no depender
    // de claves de Clerk en el test.
    harness.use((req, res, next) => {
        req.auth = Object.assign(() => ({ userId: null, tokenType: "session_token", isAuthenticated: false }), {
            [CLERK_AUTH_BRAND]: true,
        });
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

test("/debug/prisma-user ya no existe (404 en cualquier método)", async () => {
    for (const method of ["GET", "POST"]) {
        const res = await fetch(`${baseUrl}/debug/prisma-user`, { method });
        assert.equal(res.status, 404, method);
    }
});

test("/api/health sigue respondiendo", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
});
