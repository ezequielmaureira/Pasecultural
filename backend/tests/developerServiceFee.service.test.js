import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getServiceFeeConfigService, updateServiceFeeConfigService } from "../src/services/developerServiceFee.service.js";
import { getServiceFeeConfig, updateServiceFeeConfig } from "../src/controllers/developerServiceFee.controller.js";
import { getPublicServiceFeeTiers } from "../src/controllers/sale.controller.js";
import { replaceServiceFeeTiers } from "../src/services/serviceFee.service.js";
import { requireRole } from "../src/middlewares/requireRole.js";

// Ronda de endurecimiento — Developer > Configuración (CRUD de
// service_fee_tiers) no tenía ningún test de integración contra DB real
// todavía. CRUD + transacciones + control de acceso por rol, no expresable
// como funciones puras (la validación pura ya está cubierta en
// serviceFee.service.test.js) — se prueba contra Postgres real
// (backend/.env.test), nunca con mocks de Prisma. Guardrail centralizado —
// ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `user_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function cleanup({ userIds = [] }) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function fakeRes() {
    const state = {};
    const res = {
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

function fakeReqWithAuth(clerkId) {
    const req = { headers: {}, body: {} };
    req.auth = Object.assign(() => ({ userId: clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

function fakeUnauthenticatedReq() {
    const req = { headers: {}, body: {} };
    req.auth = Object.assign(() => ({ userId: null, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

// service_fee_tiers es una tabla GLOBAL (no por-test, no por-organización)
// — a diferencia del resto de las fixtures de este archivo, no se puede
// aislar creando filas con sufijos únicos. Estos helpers graban el
// contenido exacto de antes de mutar y lo restauran al terminar, siempre
// en un finally, para que ningún otro archivo de test:db que lea tiers
// (mercadoPagoCheckout.service.test.js) encuentre la tabla en un estado
// distinto al que tenía antes de correr este archivo.
async function snapshotTiers() {
    const rows = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
    return rows.map((t) => ({ minAmount: Number(t.minAmount), maxAmount: t.maxAmount == null ? null : Number(t.maxAmount), feeAmount: Number(t.feeAmount) }));
}

async function restoreTiers(originalInput) {
    await replaceServiceFeeTiers(originalInput, null);
}

// ==================================================================
// Control de acceso — requireRole("DEVELOPER") es EXACTAMENTE el mismo
// middleware para GET y PUT /api/developer/service-fee (ver
// developerServiceFee.routes.js: ambas rutas lo usan sin ninguna
// diferencia), así que probarlo una vez alcanza para las dos — nunca hace
// falta duplicar el mismo chequeo por endpoint.
// ==================================================================

testWithDb("requireRole('DEVELOPER') blocks an ORGANIZER from GET/PUT /api/developer/service-fee", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = fakeReqWithAuth(organizer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false, "un ORGANIZER nunca debe poder leer ni modificar la configuración de comisión");
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [organizer.id] });
    }
});

testWithDb("requireRole('DEVELOPER') blocks a SCANNER from GET/PUT /api/developer/service-fee", async () => {
    const scanner = await createUser({ role: "SCANNER" });
    try {
        const req = fakeReqWithAuth(scanner.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false, "un SCANNER nunca debe poder leer ni modificar la configuración de comisión");
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [scanner.id] });
    }
});

testWithDb("requireRole('DEVELOPER') blocks a CUSTOMER from GET/PUT /api/developer/service-fee", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    try {
        const req = fakeReqWithAuth(customer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false, "un CUSTOMER nunca debe poder leer ni modificar la configuración de comisión");
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [customer.id] });
    }
});

testWithDb("requireRole('DEVELOPER') blocks an unauthenticated request to GET/PUT /api/developer/service-fee", async () => {
    const req = fakeUnauthenticatedReq();
    const { res, state } = fakeRes();
    let nextCalled = false;
    await requireRole("DEVELOPER")(req, res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, false, "sin sesión nunca debe poder leer ni modificar la configuración de comisión");
    assert.equal(state.statusCode, 401);
});

testWithDb("a DEVELOPER passes requireRole('DEVELOPER') and can reach GET/PUT /api/developer/service-fee", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, true, "un DEVELOPER sí debe poder llegar al controller");
        assert.equal(req.dbUser.id, developer.id, "requireRole debe resolver req.dbUser para que el controller lo use como updatedByUserId");
        assert.equal(state.statusCode, undefined, "requireRole no debe responder nada por su cuenta cuando el rol es válido");
    } finally {
        await cleanup({ userIds: [developer.id] });
    }
});

// ==================================================================
// CRUD real contra Postgres — reemplazo atómico, validación, y que un
// fallo de transacción no deje una configuración a medias.
// ==================================================================

testWithDb("a DEVELOPER can replace the full set of tiers atomically; the change is immediately visible via GET and via the public endpoint, which never exposes updatedByUserId/id/updatedAt", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const originalTiers = await snapshotTiers();
    try {
        const publicReq = { headers: {} };
        const publicResBefore = fakeRes();
        await getPublicServiceFeeTiers(publicReq, publicResBefore.res, () => {});
        const versionBefore = publicResBefore.state.jsonBody.configVersion;

        const newTiers = [
            { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
            { minAmount: 5000, maxAmount: 10000, feeAmount: 700 },
            { minAmount: 10000, maxAmount: 50000, feeAmount: 1000 },
            { minAmount: 50000, maxAmount: null, feeAmount: 2000 },
        ];

        const req = fakeReqWithAuth(developer.clerkId);
        // requireRole ya se prueba aparte arriba ("a DEVELOPER passes
        // requireRole...") — acá sólo se usa como setup para poblar
        // req.dbUser, exactamente como lo haría Express antes de llegar al
        // controller.
        await requireRole("DEVELOPER")(req, fakeRes().res, () => {});
        req.body = { tiers: newTiers };
        const { res, state } = fakeRes();
        await updateServiceFeeConfig(req, res, () => {});

        assert.equal(state.statusCode, 200, "un update válido nunca debe pasar por next(error)");
        assert.ok(state.jsonBody, "debe devolver la configuración ya actualizada");
        assert.equal(state.jsonBody.tiers.length, 4);
        assert.equal(state.jsonBody.tiers.find((t) => t.minAmount === 5000).feeAmount, 700);
        // MP-6 (ronda de endurecimiento) — ni siquiera la respuesta que ve
        // el propio DEVELOPER expone quién hizo el cambio anterior, sólo
        // cuándo (lastUpdatedAt/updatedAt) — mismo criterio de minimizar
        // qué se expone, ver serializeTier en developerServiceFee.service.js.
        assert.ok(!("updatedByUserId" in state.jsonBody.tiers[0]));

        // Persistido de verdad: se lee de nuevo, aparte, sin depender de
        // lo que devolvió el PUT.
        const persisted = await getServiceFeeConfigService();
        assert.equal(persisted.tiers.length, 4);
        assert.equal(persisted.tiers.find((t) => t.minAmount === 5000).feeAmount, 700);

        // El endpoint público refleja el cambio de inmediato (sin caché,
        // ver el comentario de getActiveServiceFeeTiers) y nunca expone
        // id/updatedAt/updatedByUserId de cada rango — sólo minAmount/
        // maxAmount/feeAmount, más el hash de contenido.
        const publicResAfter = fakeRes();
        await getPublicServiceFeeTiers(publicReq, publicResAfter.res, () => {});
        const bodyAfter = publicResAfter.state.jsonBody;
        assert.equal(bodyAfter.tiers.length, 4);
        assert.equal(bodyAfter.tiers.find((t) => t.minAmount === 5000).feeAmount, 700);
        for (const tier of bodyAfter.tiers) {
            assert.deepEqual(Object.keys(tier).sort(), ["feeAmount", "maxAmount", "minAmount"]);
        }
        assert.notEqual(bodyAfter.configVersion, versionBefore, "el hash de contenido debe cambiar cuando cambian los valores de los rangos");
    } finally {
        await restoreTiers(originalTiers);
        await cleanup({ userIds: [developer.id] });
    }
});

testWithDb("invalid ranges are rejected (SERVICE_FEE_TIERS_INVALID) and the existing configuration is left completely untouched", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const before = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
    try {
        // Hueco entre $5.000 y $8.000: ningún rango cubre esos precios —
        // rechazado por validateServiceFeeTiersInput ANTES de que
        // replaceServiceFeeTiers abra ninguna transacción.
        const invalidTiers = [
            { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
            { minAmount: 8000, maxAmount: null, feeAmount: 2000 },
        ];

        await assert.rejects(
            () => updateServiceFeeConfigService(developer.id, invalidTiers),
            (error) => {
                assert.equal(error.code, "SERVICE_FEE_TIERS_INVALID");
                assert.ok(Array.isArray(error.details) && error.details.length > 0);
                return true;
            }
        );

        const after = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
        assert.equal(after.length, before.length);
        for (let i = 0; i < before.length; i++) {
            assert.equal(after[i].id, before[i].id, "una escritura inválida nunca debe tocar ni una sola fila existente");
            assert.equal(Number(after[i].feeAmount), Number(before[i].feeAmount));
            assert.equal(after[i].updatedAt.getTime(), before[i].updatedAt.getTime());
        }
    } finally {
        await cleanup({ userIds: [developer.id] });
    }
});

testWithDb("if the replace transaction fails partway through, no partial configuration remains (delete without insert is rolled back together)", async () => {
    const before = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
    try {
        const validShapeTiers = [
            { minAmount: 0, maxAmount: 5000, feeAmount: 150 },
            { minAmount: 5000, maxAmount: null, feeAmount: 900 },
        ];
        // updatedByUserId apunta a un usuario que no existe — pasa la
        // validación de forma (es sólo un string), pero viola la foreign
        // key real de la tabla al hacer el createMany dentro de la MISMA
        // transacción que ya corrió el deleteMany — un fallo genuino de
        // Postgres, no simulado con un mock.
        const nonExistentUserId = randomUUID();

        await assert.rejects(() => replaceServiceFeeTiers(validShapeTiers, nonExistentUserId));

        const after = await prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
        assert.equal(after.length, before.length, "el deleteMany() de la transacción fallida debe haber quedado revertido junto con el createMany()");
        for (let i = 0; i < before.length; i++) {
            assert.equal(after[i].id, before[i].id);
            assert.equal(Number(after[i].feeAmount), Number(before[i].feeAmount));
        }
    } finally {
        // Nada que restaurar si el rollback funcionó, pero se verifica
        // igual por si acaso, para no dejar el resto de la suite en un
        // estado corrupto si esta aserción alguna vez fallara.
        const current = await snapshotTiers();
        const beforeInput = before.map((t) => ({ minAmount: Number(t.minAmount), maxAmount: t.maxAmount == null ? null : Number(t.maxAmount), feeAmount: Number(t.feeAmount) }));
        const changed = current.length !== beforeInput.length || current.some((t, i) => t.minAmount !== beforeInput[i].minAmount || t.maxAmount !== beforeInput[i].maxAmount || t.feeAmount !== beforeInput[i].feeAmount);
        if (changed) await restoreTiers(beforeInput);
    }
});
