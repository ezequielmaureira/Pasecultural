import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    getMercadoPagoConnectionStatusService,
    startMercadoPagoConnectService,
    handleMercadoPagoOAuthCallbackService,
    refreshMercadoPagoConnectionTokens,
    disconnectMercadoPagoConnectionService,
} from "../src/services/mercadoPagoConnection.service.js";
import { requireRole } from "../src/middlewares/requireRole.js";

// MP-1 — onboarding OAuth de Mercado Pago. Mismo criterio que
// organizationPhoneVerification.crud.test.js/eventServicePort.commit.perf.test.js:
// esto es CRUD + transacciones + concurrencia real, no expresable como
// funciones puras, así que se prueba contra Postgres real
// (backend/.env.test), nunca con mocks de Prisma. Guardrail centralizado —
// ver tests/helpers/dbGuard.js (NUNCA un segundo guardrail casero).
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

// Meta— digo, Mercado Pago — nunca se llama de verdad: globalThis.fetch se
// mockea por test (mismo patrón que tests/mercadoPago.send.test.js /
// tests/whatsapp.send.test.js). Configuración fijada UNA vez acá arriba,
// a nivel de módulo (lazy-cacheada en memoria, mismo criterio que el resto
// del proyecto).
process.env.MERCADOPAGO_CLIENT_ID = "test-client-id";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret";
process.env.MERCADOPAGO_REDIRECT_URI = "https://api.pasecultural.test/api/mercadopago/oauth/callback";
process.env.MERCADOPAGO_TOKEN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

function mockMpExchange(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = original;
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockMpExchangeSuccess(overrides = {}) {
    return mockMpExchange(async () =>
        jsonResponse(200, {
            access_token: `APP_USR-${randomUUID().slice(0, 8)}`,
            refresh_token: `TG-${randomUUID().slice(0, 8)}`,
            user_id: Math.floor(Math.random() * 1e9),
            public_key: "APP_USR-pubkey",
            live_mode: false,
            scope: "offline_access read write",
            expires_in: 15552000,
            ...overrides,
        })
    );
}

function mockMpExchangeFailure(message = "invalid_grant") {
    return mockMpExchange(async () => jsonResponse(400, { message }));
}

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `owner_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Cine Nadia ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    await prisma.mercadoPagoOAuthState.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.mercadoPagoConnection.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ==================================================================
// 1/2) STATUS — organizer autenticado, sin conexión.
// ==================================================================

testWithDb("1/2) an authorized owner can query the status, and an unconnected organization reports connected:false", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const status = await getMercadoPagoConnectionStatusService(owner.clerkId, org.id);
        assert.deepEqual(status, { connected: false, connectedAt: null, liveMode: null, mercadoPagoUserId: null });
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 3/4) STATUS — organización conectada, respuesta sin tokens.
// ==================================================================

testWithDb("3/4) a connected organization reports connected:true, and the response never contains tokens", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess();
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");
        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });

        const status = await getMercadoPagoConnectionStatusService(owner.clerkId, org.id);
        assert.equal(status.connected, true);
        assert.ok(status.connectedAt);
        assert.equal(status.liveMode, false);

        const serialized = JSON.stringify(status);
        assert.ok(!serialized.toLowerCase().includes("accesstoken"));
        assert.ok(!serialized.toLowerCase().includes("refreshtoken"));
        assert.ok(!Object.keys(status).some((k) => /token/i.test(k)), "la respuesta de status nunca debe tener ninguna clave con 'token'");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 5) CUSTOMER no puede iniciar una conexión — probado contra el
// middleware REAL (requireRole), no un doble: es la capa exacta donde
// vive esta protección para las rutas /me/mercadopago/*.
// ==================================================================

testWithDb("5) requireRole(ORGANIZER) blocks a CUSTOMER from reaching the connect/status controllers", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    try {
        const req = { headers: {} };
        let statusCode;
        let jsonBody;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                jsonBody = body;
                return this;
            },
        };
        let nextCalled = false;

        // requireRole lee la identidad vía @clerk/express#getAuth(req), que
        // exige que req.auth sea una función "marcada" con el símbolo
        // global @clerk/express.auth (ver requestHasAuthObject en
        // @clerk/express/dist/utils-*.js) — normalmente la deja así
        // clerkMiddleware(), fuera del alcance de este test unitario. Se
        // reproduce acá el mismo shape exacto (Symbol.for es del registro
        // GLOBAL, así que esta marca es indistinguible de la real para
        // getAuth) en vez de mockear getAuth mismo, para ejercitar
        // requireRole tal cual corre en producción. `tokenType:
        // "session_token"` es imprescindible: getAuth internamente llama a
        // getAuthObjectForAcceptedToken (@clerk/backend), que degrada
        // cualquier auth object sin ese campo a "signed out" (userId=null)
        // ANTES de que requireRole llegue a mirarlo — sin esto, el test
        // reportaría 401 ("No autenticado") en vez de ejercitar la
        // verificación de rol real.
        req.auth = Object.assign(() => ({ userId: customer.clerkId, tokenType: "session_token" }), {
            [Symbol.for("@clerk/express.auth")]: true,
        });

        const middleware = requireRole("ORGANIZER");
        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, false, "un CUSTOMER nunca debe llegar al controller");
        assert.equal(statusCode, 403);
        assert.ok(jsonBody?.message);
    } finally {
        await cleanup({ organizationIds: [], userIds: [customer.id] });
    }
});

// ==================================================================
// 6) un Organizer no puede operar sobre la conexión de OTRA organización.
// ==================================================================

testWithDb("6) an organizer cannot query status or start a connection for an organization they don't own", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const stranger = await createUser();
    try {
        await assert.rejects(
            () => getMercadoPagoConnectionStatusService(stranger.clerkId, org.id),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_FORBIDDEN");
                return true;
            }
        );
        await assert.rejects(
            () => startMercadoPagoConnectService(stranger.clerkId, org.id),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_FORBIDDEN");
                return true;
            }
        );

        const states = await prisma.mercadoPagoOAuthState.findMany({ where: { organizationId: org.id } });
        assert.equal(states.length, 0, "un pedido no autorizado nunca debe crear un state");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, stranger.id] });
    }
});

// ==================================================================
// 7/8) generación correcta de state + state válido funciona.
// ==================================================================

testWithDb("7/8) a valid, freshly generated state is high-entropy, unique, and lets the callback succeed", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess();
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        assert.ok(state && state.length >= 32, "el state debe ser de alta entropía, nunca un valor corto/predecible");

        const stored = await prisma.mercadoPagoOAuthState.findUnique({ where: { stateToken: state } });
        assert.ok(stored);
        assert.equal(stored.organizationId, org.id);
        assert.equal(stored.requestedByUserId, owner.id);

        const result = await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });
        assert.equal(result.organizationId, org.id);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 9) state inválido (nunca existió) es rechazado.
// ==================================================================

testWithDb("9) an invalid state (never issued) is rejected, and Mercado Pago is never called", async () => {
    let mpCalled = false;
    const restore = mockMpExchange(async () => {
        mpCalled = true;
        return jsonResponse(200, {});
    });
    try {
        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state: "never-existed" }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_STATE_INVALID");
                return true;
            }
        );
        assert.equal(mpCalled, false, "un state inválido nunca debe llegar a intercambiar el code con Mercado Pago");
    } finally {
        restore();
    }
});

// ==================================================================
// 10) state expirado es rechazado.
// ==================================================================

testWithDb("10) an expired state is rejected, without touching Mercado Pago", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const stateToken = `expired_${uniqueSuffix()}`;
    await prisma.mercadoPagoOAuthState.create({
        data: {
            stateToken,
            organizationId: org.id,
            requestedByUserId: owner.id,
            expiresAt: new Date(Date.now() - 1000), // ya vencido
        },
    });
    let mpCalled = false;
    const restore = mockMpExchange(async () => {
        mpCalled = true;
        return jsonResponse(200, {});
    });
    try {
        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state: stateToken }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_STATE_EXPIRED");
                return true;
            }
        );
        assert.equal(mpCalled, false);

        const stillThere = await prisma.mercadoPagoOAuthState.findUnique({ where: { stateToken } });
        assert.equal(stillThere, null, "un state vencido se descarta, nunca queda esperando a que alguien lo reclame más tarde");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 11) state reutilizado es rechazado (single-use real).
// ==================================================================

testWithDb("11) a reused state is rejected on the second attempt, and never migrates/connects twice", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess();
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });

        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_STATE_INVALID");
                return true;
            }
        );
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 12/13) callback sin code / sin state falla controladamente.
// ==================================================================

testWithDb("12) callback without a code fails in a controlled way", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: undefined, state }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_CODE_REQUIRED");
                return true;
            }
        );

        // El state NUNCA se consume por un callback sin code (nada que
        // intercambiar) — sigue disponible para el intento real.
        const stillThere = await prisma.mercadoPagoOAuthState.findUnique({ where: { stateToken: state } });
        assert.ok(stillThere, "un callback sin code no debe consumir el state");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("13) callback without a state fails in a controlled way, and Mercado Pago is never called", async () => {
    let mpCalled = false;
    const restore = mockMpExchange(async () => {
        mpCalled = true;
        return jsonResponse(200, {});
    });
    try {
        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state: undefined }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_STATE_INVALID");
                return true;
            }
        );
        assert.equal(mpCalled, false);
    } finally {
        restore();
    }
});

// ==================================================================
// 14) intercambio OAuth exitoso persiste la conexión (tokens cifrados).
// ==================================================================

testWithDb("14) a successful OAuth exchange persists an encrypted connection", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess({ access_token: "APP_USR-PLAINTEXT-MARKER", refresh_token: "TG-PLAINTEXT-MARKER" });
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");
        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.ok(connection);
        assert.notEqual(connection.accessTokenEncrypted, "APP_USR-PLAINTEXT-MARKER");
        assert.notEqual(connection.refreshTokenEncrypted, "TG-PLAINTEXT-MARKER");
        assert.ok(!connection.accessTokenEncrypted.includes("PLAINTEXT-MARKER"));
        assert.ok(!connection.refreshTokenEncrypted.includes("PLAINTEXT-MARKER"));
        assert.ok(connection.accessTokenExpiresAt > new Date());
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 15/16) error de Mercado Pago falla controladamente, sin filtrar tokens.
// ==================================================================

testWithDb("15/16) a Mercado Pago rejection fails in a controlled way, and no token ever appears in the error", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeFailure("invalid_grant");
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        await assert.rejects(
            () => handleMercadoPagoOAuthCallbackService({ code: "BAD_CODE", state }),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_EXCHANGE_FAILED");
                assert.ok(!JSON.stringify(error).toLowerCase().includes("access_token"));
                assert.ok(!JSON.stringify(error).toLowerCase().includes("refresh_token"));
                return true;
            }
        );

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.equal(connection, null, "un intercambio fallido nunca debe dejar una conexión persistida");
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 17) reconectar la misma Organization — bug fix (desconexión de Mercado
// Pago): YA NO sobreescribe la fila existente (eso perdía para siempre el
// mercadoPagoUserId/tokens de la cuenta anterior, rompiendo cualquier
// webhook tardío de un payment cobrado con ella). Ahora la reconexión deja
// DOS filas: la primera pasa a DISCONNECTED (conservada tal cual), la
// segunda queda ACTIVE con la cuenta nueva — nunca más de una ACTIVE al
// mismo tiempo.
// ==================================================================

testWithDb("17) reconnecting the same organization keeps the previous connection as DISCONNECTED instead of overwriting it", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess({ access_token: "APP_USR-first", refresh_token: "TG-first", user_id: 111111 });
    try {
        const first = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const firstState = new URL(first.authorizationUrl).searchParams.get("state");
        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE_1", state: firstState });

        restore();
        const restoreSecond = mockMpExchangeSuccess({ access_token: "APP_USR-second", refresh_token: "TG-second", user_id: 222222 });
        const second = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const secondState = new URL(second.authorizationUrl).searchParams.get("state");
        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE_2", state: secondState });
        restoreSecond();

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id }, orderBy: { connectedAt: "asc" } });
        assert.equal(connections.length, 2, "la reconexión debe crear una fila nueva, nunca pisar la anterior");

        const [older, newer] = connections;
        assert.equal(older.mercadoPagoUserId, "111111");
        assert.equal(older.status, "DISCONNECTED");
        assert.ok(older.disconnectedAt, "la fila vieja debe quedar marcada con cuándo se desactivó");

        assert.equal(newer.mercadoPagoUserId, "222222");
        assert.equal(newer.status, "ACTIVE");
        assert.equal(newer.disconnectedAt, null);

        // Sólo una ACTIVE a la vez.
        const activeCount = connections.filter((c) => c.status === "ACTIVE").length;
        assert.equal(activeCount, 1);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Bug fix (desconexión de Mercado Pago) — DISCONNECT.
// ==================================================================

async function connectOrg(clerkId, organizationId, overrides = {}) {
    const restore = mockMpExchangeSuccess(overrides);
    const { authorizationUrl } = await startMercadoPagoConnectService(clerkId, organizationId);
    const state = new URL(authorizationUrl).searchParams.get("state");
    await handleMercadoPagoOAuthCallbackService({ code: `AUTH_CODE_${uniqueSuffix()}`, state });
    restore();
}

testWithDb("disconnect: marks the active connection DISCONNECTED, never deletes it, and never returns a token", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, org.id);

        const result = await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        assert.deepEqual(result, { disconnected: true });
        assert.ok(!JSON.stringify(result).toLowerCase().includes("token"), "la respuesta nunca debe incluir ningún token");

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.ok(connection, "la fila se conserva — nunca se borra");
        assert.equal(connection.status, "DISCONNECTED");
        assert.ok(connection.disconnectedAt);

        const status = await getMercadoPagoConnectionStatusService(owner.clerkId, org.id);
        assert.deepEqual(status, { connected: false, connectedAt: null, liveMode: null, mercadoPagoUserId: null });
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("disconnect: a user who does not own the organization is forbidden, and the connection stays untouched", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, org.id);

        await assert.rejects(
            () => disconnectMercadoPagoConnectionService(stranger.clerkId, org.id),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_FORBIDDEN");
                return true;
            }
        );

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.equal(connection.status, "ACTIVE", "un intento no autorizado nunca debe desconectar nada");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id, stranger.id] });
    }
});

testWithDb("disconnect: an organizationId that does not belong to the caller (wrong organization) is forbidden", async () => {
    const owner = await createUser();
    const otherOwner = await createUser();
    const org = await createOrganization(owner.id);
    const otherOrg = await createOrganization(otherOwner.id);
    try {
        await connectOrg(otherOwner.clerkId, otherOrg.id);

        // El dueño de `org` intenta desconectar `otherOrg` — nunca alcanza
        // con estar autenticado como ORGANIZER: tiene que ser dueño de ESA
        // Organization puntual.
        await assert.rejects(
            () => disconnectMercadoPagoConnectionService(owner.clerkId, otherOrg.id),
            (error) => {
                assert.equal(error.code, "MERCADOPAGO_FORBIDDEN");
                return true;
            }
        );

        const otherConnection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: otherOrg.id } });
        assert.equal(otherConnection.status, "ACTIVE");
    } finally {
        await cleanup({ organizationIds: [org.id, otherOrg.id], userIds: [owner.id, otherOwner.id] });
    }
});

testWithDb("disconnect: repeating it on an already-disconnected organization is idempotent, never an error", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, org.id);

        const first = await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        const second = await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        assert.deepEqual(first, { disconnected: true });
        assert.deepEqual(second, { disconnected: true });

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id } });
        assert.equal(connections.length, 1, "un segundo disconnect nunca debe crear ni duplicar filas");
        assert.equal(connections[0].status, "DISCONNECTED");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("disconnect: an organization that was never connected can still be 'disconnected' without error", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        const result = await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);
        assert.deepEqual(result, { disconnected: true });

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id } });
        assert.equal(connections.length, 0, "nunca se crea una fila sólo por desconectar algo que no existía");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("disconnect: two concurrent disconnect requests never leave an inconsistent state", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, org.id);

        const results = await Promise.allSettled([
            disconnectMercadoPagoConnectionService(owner.clerkId, org.id),
            disconnectMercadoPagoConnectionService(owner.clerkId, org.id),
        ]);
        // Ambos terminan en éxito (idempotente) — nunca uno de los dos
        // lanza ni deja la fila a medio actualizar.
        assert.ok(results.every((r) => r.status === "fulfilled"), "ningún disconnect concurrente debe rechazar");

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id } });
        assert.equal(connections.length, 1);
        assert.equal(connections[0].status, "DISCONNECTED");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("disconnect: disconnecting organization A never touches organization B's connection", async () => {
    const owner = await createUser();
    const orgA = await createOrganization(owner.id);
    const orgB = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, orgA.id);
        await connectOrg(owner.clerkId, orgB.id);

        await disconnectMercadoPagoConnectionService(owner.clerkId, orgA.id);

        const connectionA = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: orgA.id } });
        const connectionB = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: orgB.id } });
        assert.equal(connectionA.status, "DISCONNECTED");
        assert.equal(connectionB.status, "ACTIVE", "desconectar A nunca debe afectar a B");
    } finally {
        await cleanup({ organizationIds: [orgA.id, orgB.id], userIds: [owner.id] });
    }
});

testWithDb("disconnect then reconnect: the organization can connect a different account afterwards, and status reflects the new one", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    try {
        await connectOrg(owner.clerkId, org.id, { user_id: 111111 });
        await disconnectMercadoPagoConnectionService(owner.clerkId, org.id);

        let status = await getMercadoPagoConnectionStatusService(owner.clerkId, org.id);
        assert.equal(status.connected, false);

        await connectOrg(owner.clerkId, org.id, { user_id: 222222 });

        status = await getMercadoPagoConnectionStatusService(owner.clerkId, org.id);
        assert.equal(status.connected, true);
        assert.equal(status.mercadoPagoUserId, "222222");

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id } });
        assert.equal(connections.length, 2, "la cuenta vieja se conserva, DISCONNECTED, junto a la nueva ACTIVE");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// 18) el callback no puede usarse para conectar Mercado Pago a otra
// Organization — organizationId sale EXCLUSIVAMENTE del state, nunca de
// ningún otro parámetro.
// ==================================================================

testWithDb("18) the callback can never be used to connect Mercado Pago to a different organization than the one that requested it", async () => {
    const owner = await createUser();
    const orgA = await createOrganization(owner.id);
    const orgB = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess();
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, orgA.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        // handleMercadoPagoOAuthCallbackService no acepta ningún parámetro
        // de organización — sólo {code, state} — así que no hay forma de
        // pedirle "conectá esto a orgB" aunque se quisiera: se verifica acá
        // que el resultado real SIEMPRE es la organización del state.
        const result = await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });
        assert.equal(result.organizationId, orgA.id);

        const connectionB = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: orgB.id } });
        assert.equal(connectionB, null, "orgB nunca debe verse afectada por un callback que corresponde a orgA");
    } finally {
        restore();
        await cleanup({ organizationIds: [orgA.id, orgB.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Concurrencia — dos callbacks concurrentes con el mismo state (doble tab
// / reintento de red) sólo pueden completar uno.
// ==================================================================

testWithDb("two concurrent callbacks with the same state complete exactly once", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restore = mockMpExchangeSuccess();
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        const results = await Promise.allSettled([
            handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state }),
            handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactamente uno de los dos callbacks concurrentes debe completar");
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, "MERCADOPAGO_STATE_INVALID");

        const connections = await prisma.mercadoPagoConnection.findMany({ where: { organizationId: org.id } });
        assert.equal(connections.length, 1);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Renovación — aislada, testeada, nunca llamada automáticamente en MP-1.
// ==================================================================

testWithDb("refreshMercadoPagoConnectionTokens rotates both tokens atomically and never exposes them", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const restoreInitial = mockMpExchangeSuccess({ access_token: "APP_USR-initial", refresh_token: "TG-initial" });
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");
        await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });
        restoreInitial();

        const before = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });

        const restoreRefresh = mockMpExchangeSuccess({ access_token: "APP_USR-rotated", refresh_token: "TG-rotated" });
        const result = await refreshMercadoPagoConnectionTokens(org.id);
        restoreRefresh();

        assert.equal(result.refreshed, true);
        const after = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.notEqual(after.accessTokenEncrypted, before.accessTokenEncrypted);
        assert.notEqual(after.refreshTokenEncrypted, before.refreshTokenEncrypted);
        assert.ok(!after.accessTokenEncrypted.includes("rotated"));
        assert.ok(!after.refreshTokenEncrypted.includes("rotated"));
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

testWithDb("refreshMercadoPagoConnectionTokens reports NOT_CONNECTED without ever calling Mercado Pago for an organization with no connection", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let mpCalled = false;
    const restore = mockMpExchange(async () => {
        mpCalled = true;
        return jsonResponse(200, {});
    });
    try {
        const result = await refreshMercadoPagoConnectionTokens(org.id);
        assert.deepEqual(result, { refreshed: false, reason: "NOT_CONNECTED" });
        assert.equal(mpCalled, false);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// ==================================================================
// Revisión post-entrega — un error transitorio (red/timeout/5xx) al
// intercambiar el code se reintenta DENTRO de mercadoPago.service.js,
// sin reabrir ni tocar el consumo del state acá: la misma invocación de
// handleMercadoPagoOAuthCallbackService que ya reclamó el state de forma
// atómica es la que, puertas adentro, reintenta la llamada a Mercado
// Pago antes de resolver. Termina en éxito (conexión persistida, state
// consumido una sola vez) sin que el caller note que hubo un primer
// intento fallido.
// ==================================================================

testWithDb("a transient failure on the first exchange attempt is retried transparently and the connection still persists", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let calls = 0;
    const restore = mockMpExchange(async () => {
        calls += 1;
        if (calls === 1) throw new Error("ECONNRESET");
        return jsonResponse(200, {
            access_token: `APP_USR-${randomUUID().slice(0, 8)}`,
            refresh_token: `TG-${randomUUID().slice(0, 8)}`,
            user_id: 555,
            live_mode: false,
            scope: "offline_access",
            expires_in: 15552000,
        });
    });
    try {
        const { authorizationUrl } = await startMercadoPagoConnectService(owner.clerkId, org.id);
        const state = new URL(authorizationUrl).searchParams.get("state");

        const result = await handleMercadoPagoOAuthCallbackService({ code: "AUTH_CODE", state });
        assert.equal(result.organizationId, org.id);
        assert.equal(calls, 2, "el primer intento falló transitoriamente, el segundo (reintento interno) tuvo éxito");

        const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId: org.id } });
        assert.ok(connection, "la conexión debe quedar persistida a pesar del primer intento fallido");

        // El state ya se consumió con esta única invocación — no queda
        // disponible para un segundo uso, ni siquiera porque el primer
        // intento interno haya fallado.
        const remainingState = await prisma.mercadoPagoOAuthState.findUnique({ where: { stateToken: state } });
        assert.equal(remainingState, null);
    } finally {
        restore();
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});
