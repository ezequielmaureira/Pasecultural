import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";

// Authorization: Bearer <token malformado> → antes 500 (SyntaxError crudo de
// @clerk/backend#decodeJwt propagado por clerkMiddleware), ahora la request
// sigue sin sesión: pública → 200, protegida → 401. Se ejercita el
// clerkMiddleware REAL (middlewares/clerkAuth.js) sin red ni Clerk: claves
// falsas + CLERK_JWT_KEY con un par RSA generado acá (verificación
// networkless), así también se prueba que un token VÁLIDO sigue
// autenticando igual. Sin base de datos: DATABASE_URL a un puerto local
// cerrado y prisma.user.findUnique stubbeado para requireAuth.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.CLERK_SECRET_KEY = "sk_test_unit-fake-not-a-key";
process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;
process.env.CLERK_JWT_KEY = publicKey.export({ type: "spki", format: "pem" });
process.env.CLERK_TELEMETRY_DISABLED = "1";

const { default: prisma } = await import("../src/config/prisma.js");
const { default: app } = await import("../src/app.js");

const users = new Map([
    ["user_active", { id: "u1", clerkId: "user_active", role: "CUSTOMER", status: "ACTIVE" }],
    ["user_suspended", { id: "u2", clerkId: "user_suspended", role: "CUSTOMER", status: "SUSPENDED" }],
]);
prisma.user.findUnique = async ({ where }) => (where.clerkId ? users.get(where.clerkId) ?? null : null);
// /api/sales/mine para un ACTIVE llega al service: se corta acá sin DB.
prisma.sale.findMany = async () => [];

function b64url(value) {
    return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}
function signSessionToken(sub) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url({ alg: "RS256", typ: "JWT", kid: "ins_unit" });
    const payload = b64url({ sub, sid: "sess_unit", iss: "https://example.clerk.accounts.dev", iat: now - 5, nbf: now - 5, exp: now + 300 });
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

let server;
let baseUrl;
test.before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

async function call(path, token) {
    const res = await fetch(`${baseUrl}${path}`, { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } });
    let body = null;
    try {
        body = await res.json();
    } catch {
        // sin body JSON
    }
    return { status: res.status, body };
}

const MALFORMED = {
    threeInvalidSegments: "invalid.token.value",
    emptySegments: "..",
    notJsonSegments: "aGVsbG8.aGVsbG8.aGVsbG8",
};

test("token malformado en ruta protegida → 401 (antes 500)", async () => {
    for (const [name, token] of Object.entries(MALFORMED)) {
        const res = await call("/api/sales/mine", token);
        assert.equal(res.status, 401, name);
    }
});

test("token malformado en rutas públicas → responden normal (antes 500)", async () => {
    for (const [name, token] of Object.entries(MALFORMED)) {
        assert.equal((await call("/api/health", token)).status, 200, `health ${name}`);
        assert.equal((await call("/api/events/categories", token)).status, 200, `categories ${name}`);
    }
});

test("token con firma inválida / basura no-JWT → sin sesión (401), como antes", async () => {
    const good = signSessionToken("user_active");
    const tampered = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
    for (const token of [tampered, "abc", "x".repeat(300)]) {
        assert.equal((await call("/api/sales/mine", token)).status, 401);
    }
});

test("sin token → 401 en protegida, 200 en pública (sin cambios)", async () => {
    assert.equal((await call("/api/sales/mine")).status, 401);
    assert.equal((await call("/api/health")).status, 200);
});

test("token VÁLIDO de un usuario ACTIVE sigue autenticando (pasa requireAuth)", async () => {
    const res = await call("/api/sales/mine", signSessionToken("user_active"));
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 500);
});

test("token VÁLIDO de un usuario SUSPENDED → 403 USER_SUSPENDED (sin cambios)", async () => {
    const res = await call("/api/sales/mine", signSessionToken("user_suspended"));
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "USER_SUSPENDED");
});
