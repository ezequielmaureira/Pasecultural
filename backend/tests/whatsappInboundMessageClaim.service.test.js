import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/config/prisma.js";
import { claimInboundMessage, completeInboundMessageClaim, failInboundMessageClaim, CLAIM_LEASE_MS } from "../src/services/whatsappInboundMessageClaim.service.js";
import { logger } from "../src/logging/logger.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";

// Fase CIERRE — idempotencia de mensajes entrantes de WhatsApp. Este
// service es CRUD/reclamo atómico puro contra Postgres real (mismo
// criterio que el resto de los services que tocan Prisma en este proyecto,
// ver whatsappPendingStepInput.service.test.js): se salta limpiamente
// (nunca falla) cuando no hay una base de TEST confirmada.
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

// wamid único por test (con timestamp+random) para que corridas
// consecutivas/paralelas nunca choquen entre sí por una fila que quedó de
// una corrida anterior.
function uniqueWamid(label) {
    return `wamid.TEST_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function deleteClaim(wamid) {
    await prisma.whatsappInboundMessageClaim.deleteMany({ where: { wamid } });
}

// ==================================================================
// 1) wamid nuevo -> reclamo exitoso, una sola escritura.
// ==================================================================
testWithDb("1) a brand-new wamid is claimed successfully and persisted as PROCESSING", async () => {
    const wamid = uniqueWamid("new");
    try {
        const result = await claimInboundMessage(wamid);
        assert.deepEqual(result, { claimed: true });

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.status, "PROCESSING");
        assert.equal(row.attempts, 1);
        assert.ok(row.leaseExpiresAt.getTime() > Date.now());
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 2) mismo wamid entregado secuencialmente, ya COMPLETED -> se ignora.
// ==================================================================
testWithDb("2) a wamid already COMPLETED is ignored on a later sequential delivery", async () => {
    const wamid = uniqueWamid("completed");
    try {
        await claimInboundMessage(wamid);
        await completeInboundMessageClaim(wamid);

        const second = await claimInboundMessage(wamid);
        assert.deepEqual(second, { claimed: false, reason: "COMPLETED" });

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.status, "COMPLETED", "un duplicado ignorado nunca debe volver a tocar el estado terminal");
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 3) dos reclamos CONCURRENTES del mismo wamid nuevo -> exactamente uno gana
// (prueba real de la restricción @unique de Postgres bajo carrera real).
// ==================================================================
testWithDb("3) two concurrent claims of the same brand-new wamid: exactly one wins, the other sees IN_PROGRESS", async () => {
    const wamid = uniqueWamid("race-new");
    try {
        const [a, b] = await Promise.all([claimInboundMessage(wamid), claimInboundMessage(wamid)]);
        const winners = [a, b].filter((r) => r.claimed);
        assert.equal(winners.length, 1, "exactamente una de las dos entregas concurrentes debe ganar el reclamo");
        const loser = a.claimed ? b : a;
        assert.equal(loser.claimed, false);
        assert.equal(loser.reason, "IN_PROGRESS");

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.attempts, 1, "el perdedor de la carrera nunca debe incrementar attempts");
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 4) un wamid distinto nunca se ve afectado por el estado de otro (mismo
// "texto"/escenario, pero dos mensajes reales distintos).
// ==================================================================
testWithDb("4) a different wamid is never affected by another wamid's claim state", async () => {
    const wamidA = uniqueWamid("distinct-a");
    const wamidB = uniqueWamid("distinct-b");
    try {
        const claimA = await claimInboundMessage(wamidA);
        await completeInboundMessageClaim(wamidA);
        const claimB = await claimInboundMessage(wamidB);

        assert.equal(claimA.claimed, true);
        assert.equal(claimB.claimed, true, "un wamid nuevo y distinto siempre debe poder reclamarse, sin importar el estado de otro");
    } finally {
        await deleteClaim(wamidA);
        await deleteClaim(wamidB);
    }
});

// ==================================================================
// 8/9) un fallo queda reintentable DE INMEDIATO, y ese reintento puede
// completarse con éxito.
// ==================================================================
testWithDb("8) a failed claim is retryable immediately, without waiting for the lease to expire", async () => {
    const wamid = uniqueWamid("failed-retry");
    try {
        await claimInboundMessage(wamid);
        await failInboundMessageClaim(wamid);

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.status, "FAILED");
        assert.ok(row.leaseExpiresAt.getTime() > Date.now(), "FAILED es reintentable YA, no depende de que venza el lease");

        const retry = await claimInboundMessage(wamid);
        assert.deepEqual(retry, { claimed: true });
    } finally {
        await deleteClaim(wamid);
    }
});

testWithDb("9) the retried claim after a failure can complete successfully", async () => {
    const wamid = uniqueWamid("failed-then-complete");
    try {
        await claimInboundMessage(wamid);
        await failInboundMessageClaim(wamid);
        await claimInboundMessage(wamid);
        await completeInboundMessageClaim(wamid);

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.status, "COMPLETED");
        assert.equal(row.attempts, 2, "el reclamo de retry (tras el fallo) debe incrementar attempts");
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 10) dos reintentos CONCURRENTES del mismo wamid FAILED -> exactamente uno
// gana (misma garantía que el test 3, ahora sobre el camino FAILED).
// ==================================================================
testWithDb("10) two concurrent retries of the same FAILED wamid: exactly one wins", async () => {
    const wamid = uniqueWamid("failed-race");
    try {
        await claimInboundMessage(wamid);
        await failInboundMessageClaim(wamid);

        const [a, b] = await Promise.all([claimInboundMessage(wamid), claimInboundMessage(wamid)]);
        const winners = [a, b].filter((r) => r.claimed);
        assert.equal(winners.length, 1, "exactamente uno de los dos reintentos concurrentes debe ganar");

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.attempts, 2, "sólo el ganador debe haber incrementado attempts una vez");
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 11/12) lease de un reclamo PROCESSING: vencido se puede recuperar,
// vigente NUNCA puede robarse.
// ==================================================================
testWithDb("11) a PROCESSING claim with an expired lease can be reclaimed (crashed-worker recovery)", async () => {
    const wamid = uniqueWamid("stale-lease");
    try {
        await prisma.whatsappInboundMessageClaim.create({
            data: { wamid, status: "PROCESSING", attempts: 1, leaseExpiresAt: new Date(Date.now() - 1000) },
        });

        const result = await claimInboundMessage(wamid);
        assert.deepEqual(result, { claimed: true });

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.attempts, 2);
        assert.ok(row.leaseExpiresAt.getTime() > Date.now(), "el lease debe renovarse hacia el futuro al reclamarse de nuevo");
    } finally {
        await deleteClaim(wamid);
    }
});

testWithDb("12) a PROCESSING claim with a lease still valid cannot be stolen by another delivery", async () => {
    const wamid = uniqueWamid("live-lease");
    try {
        await prisma.whatsappInboundMessageClaim.create({
            data: { wamid, status: "PROCESSING", attempts: 1, leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS) },
        });

        const result = await claimInboundMessage(wamid);
        assert.deepEqual(result, { claimed: false, reason: "IN_PROGRESS" });

        const row = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
        assert.equal(row.attempts, 1, "un reclamo vigente nunca debe modificarse por un intento ajeno");
        assert.equal(row.status, "PROCESSING");
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 18) la restricción @unique de wamid es real en PostgreSQL, no sólo una
// suposición de la lógica de aplicación.
// ==================================================================
testWithDb("18) the wamid unique constraint is enforced by real PostgreSQL (P2002 on a raw duplicate create)", async () => {
    const wamid = uniqueWamid("unique-constraint");
    try {
        await prisma.whatsappInboundMessageClaim.create({
            data: { wamid, status: "PROCESSING", attempts: 1, leaseExpiresAt: new Date(Date.now() + 1000) },
        });

        await assert.rejects(
            () =>
                prisma.whatsappInboundMessageClaim.create({
                    data: { wamid, status: "PROCESSING", attempts: 1, leaseExpiresAt: new Date(Date.now() + 1000) },
                }),
            (error) => error.code === "P2002"
        );
    } finally {
        await deleteClaim(wamid);
    }
});

// ==================================================================
// 20) conteo exacto de operaciones Prisma.
//
// OJO — no se usa [WA_PERF]/instrumentPrismaClient acá (a diferencia de
// whatsappPendingStepInput.service.test.js): esa instrumentación sólo
// registra una operación DESPUÉS de que `query(args)` resuelve con éxito
// (ver utils/whatsappPerf.js#$allOperations) — un `create` que choca contra
// la restricción @unique (P2002, el camino de un wamid duplicado) rechaza
// esa promesa, así que nunca llega a `timer.recordDbCall(...)` y queda
// invisible en `dbCalls`, aunque el round-trip a Postgres sí ocurrió
// realmente. Es una característica preexistente de esa instrumentación (no
// se toca acá, fuera de alcance de esta fase) — para un conteo FÍSICO
// exacto (incluyendo los intentos que fallan) se envuelven acá los métodos
// reales de Prisma con un contador propio, independiente de [WA_PERF].
function countPrismaCalls(methodNames) {
    const target = prisma.whatsappInboundMessageClaim;
    const originals = {};
    const counts = {};
    for (const name of methodNames) {
        originals[name] = target[name].bind(target);
        counts[name] = 0;
        target[name] = async (...args) => {
            counts[name] += 1;
            return originals[name](...args);
        };
    }
    return {
        counts,
        total: () => Object.values(counts).reduce((sum, n) => sum + n, 0),
        restore: () => {
            for (const name of methodNames) target[name] = originals[name];
        },
    };
}

testWithDb("20a) claiming a brand-new wamid costs exactly 1 Prisma operation (create) — the happy path", async () => {
    const wamid = uniqueWamid("perf-new");
    const counter = countPrismaCalls(["create", "findUnique", "updateMany"]);
    try {
        await claimInboundMessage(wamid);
        assert.equal(counter.total(), 1, `esperaba 1 sola operación Prisma, counts: ${JSON.stringify(counter.counts)}`);
        assert.equal(counter.counts.create, 1);
    } finally {
        counter.restore();
        await deleteClaim(wamid);
    }
});

testWithDb("20b) claiming a wamid already COMPLETED costs exactly 2 Prisma operations (a failed create + 1 read), never more", async () => {
    const wamid = uniqueWamid("perf-dup");
    try {
        await claimInboundMessage(wamid);
        await completeInboundMessageClaim(wamid);

        const counter = countPrismaCalls(["create", "findUnique", "updateMany"]);
        try {
            const result = await claimInboundMessage(wamid);
            assert.deepEqual(result, { claimed: false, reason: "COMPLETED" });
            assert.equal(counter.total(), 2, `esperaba 2 operaciones Prisma, counts: ${JSON.stringify(counter.counts)}`);
            assert.equal(counter.counts.create, 1, "el create que choca contra @unique cuenta como una operación real, aunque falle");
            assert.equal(counter.counts.findUnique, 1);
            assert.equal(counter.counts.updateMany, 0, "COMPLETED nunca debe intentar el update condicional de reintento");
        } finally {
            counter.restore();
        }
    } finally {
        await deleteClaim(wamid);
    }
});

testWithDb("20c) completing or failing a held claim costs exactly 1 Prisma operation each", async () => {
    const wamidComplete = uniqueWamid("perf-complete");
    const wamidFail = uniqueWamid("perf-fail");
    try {
        await claimInboundMessage(wamidComplete);
        await claimInboundMessage(wamidFail);

        const counter = countPrismaCalls(["update"]);
        try {
            await completeInboundMessageClaim(wamidComplete);
            await failInboundMessageClaim(wamidFail);
            assert.equal(counter.total(), 2, `esperaba 1 update cada una (2 en total), counts: ${JSON.stringify(counter.counts)}`);
        } finally {
            counter.restore();
        }
    } finally {
        await deleteClaim(wamidComplete);
        await deleteClaim(wamidFail);
    }
});

// Complementa 20a/20b/20c con la vista [WA_PERF] tal cual la vería
// producción — confirma que la instrumentación real sigue asociando estas
// operaciones al timer activo (mismo mecanismo que el resto del proyecto),
// con la salvedad documentada arriba sobre llamadas que fallan.
function withPerfEnv(run) {
    const originalEnv = process.env.WHATSAPP_PERF_LOG;
    process.env.WHATSAPP_PERF_LOG = "true";
    return run().finally(() => {
        if (originalEnv === undefined) delete process.env.WHATSAPP_PERF_LOG;
        else process.env.WHATSAPP_PERF_LOG = originalEnv;
    });
}

function withPerfLogCapture(run) {
    const originalInfo = logger.info;
    const calls = [];
    logger.info = (message, context) => calls.push({ message, context });
    return run(calls).finally(() => {
        logger.info = originalInfo;
    });
}

testWithDb("20d) a successful claim of a brand-new wamid is visible in [WA_PERF] as ConversationState-style dbCalls", async () => {
    const wamid = uniqueWamid("perf-wa-log");
    try {
        await withPerfEnv(() =>
            withPerfLogCapture(async (calls) => {
                const timer = startWhatsappPerfTimer();
                enterWithActiveTimer(timer);

                await claimInboundMessage(wamid);
                await completeInboundMessageClaim(wamid);

                timer.finish({});
                const dbCalls = calls.find((c) => c.message === "[WA_PERF]").context.dbCalls;
                const labels = dbCalls.map((c) => c.label.toLowerCase());
                assert.deepEqual(labels, ["whatsappinboundmessageclaim.create", "whatsappinboundmessageclaim.update"]);
            })
        );
    } finally {
        await deleteClaim(wamid);
    }
});
