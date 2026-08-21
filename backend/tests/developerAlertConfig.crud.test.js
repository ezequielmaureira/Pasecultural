import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getDeveloperAlertConfigService, replaceDeveloperAlertConfigService, getDeveloperAlertConfigOrDefaults } from "../src/services/developerAlertConfig.service.js";
import { getDeveloperAlertConfig, updateDeveloperAlertConfig } from "../src/controllers/developerAlertConfig.controller.js";
import { requireRole } from "../src/middlewares/requireRole.js";
import { tryClaimDeveloperAlertCooldown } from "../src/services/email/sendDeveloperAlert.service.js";

// Alertas Developer — CRUD real + concurrencia del cooldown persistido
// contra Postgres real (backend/.env.test), mismo criterio que
// developerServiceFee.service.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js. NO EJECUTADO en esta ronda (ver el informe de
// entrega, sección "Tests realmente ejecutados") — el usuario pidió
// explícitamente no correr test:db esta vez; queda escrito y registrado
// en dbTestFiles.js para la próxima corrida autorizada.
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

const VALID_CONFIG = {
    highTicketPriceThreshold: 750000,
    highSaleQuantityThreshold: 40,
    eventsWindowCount: 8,
    eventsWindowHours: 12,
    salesVolumeWindowCount: 80,
    salesVolumeWindowMinutes: 45,
    refundsVolumeWindowCount: 8,
    refundsVolumeWindowHours: 12,
    withdrawalRequestsWindowCount: 3,
    withdrawalRequestsWindowHours: 12,
    alertCooldownMinutes: 30,
};

testWithDb("requireRole('DEVELOPER') blocks an ORGANIZER from GET/PUT /api/developer/alert-config", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = fakeReqWithAuth(organizer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [organizer.id] });
    }
});

testWithDb("a DEVELOPER can replace the alert config atomically via the controller, and GET reflects it immediately", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const originalRow = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        await requireRole("DEVELOPER")(req, fakeRes().res, () => {});
        req.body = VALID_CONFIG;
        const { res, state } = fakeRes();
        await updateDeveloperAlertConfig(req, res, () => {});

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.highTicketPriceThreshold, 750000);
        assert.equal(state.jsonBody.alertCooldownMinutes, 30);

        const getReq = fakeReqWithAuth(developer.clerkId);
        const getRes = fakeRes();
        await getDeveloperAlertConfig(getReq, getRes.res, () => {});
        assert.equal(getRes.state.jsonBody.highSaleQuantityThreshold, 40);
    } finally {
        if (originalRow) {
            await prisma.developerAlertConfig.update({
                where: { id: originalRow.id },
                data: {
                    highTicketPriceThreshold: originalRow.highTicketPriceThreshold,
                    highSaleQuantityThreshold: originalRow.highSaleQuantityThreshold,
                    eventsWindowCount: originalRow.eventsWindowCount,
                    eventsWindowHours: originalRow.eventsWindowHours,
                    salesVolumeWindowCount: originalRow.salesVolumeWindowCount,
                    salesVolumeWindowMinutes: originalRow.salesVolumeWindowMinutes,
                    refundsVolumeWindowCount: originalRow.refundsVolumeWindowCount,
                    refundsVolumeWindowHours: originalRow.refundsVolumeWindowHours,
                    withdrawalRequestsWindowCount: originalRow.withdrawalRequestsWindowCount,
                    withdrawalRequestsWindowHours: originalRow.withdrawalRequestsWindowHours,
                    alertCooldownMinutes: originalRow.alertCooldownMinutes,
                    updatedByUserId: originalRow.updatedByUserId,
                },
            });
        }
        await cleanup({ userIds: [developer.id] });
    }
});

testWithDb("invalid config is rejected and the existing configuration is left completely untouched", async () => {
    const before = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
    await assert.rejects(
        () => replaceDeveloperAlertConfigService(before?.updatedByUserId ?? "whatever", { ...VALID_CONFIG, highTicketPriceThreshold: -1 }),
        (error) => {
            assert.equal(error.code, "DEVELOPER_ALERT_CONFIG_INVALID");
            assert.ok(Array.isArray(error.details) && error.details.length > 0);
            return true;
        }
    );
    const after = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
    assert.equal(after?.id, before?.id);
    assert.equal(Number(after?.highTicketPriceThreshold), Number(before?.highTicketPriceThreshold));
});

testWithDb("getDeveloperAlertConfigOrDefaults never throws even if called many times concurrently", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => getDeveloperAlertConfigOrDefaults()));
    for (const r of results) {
        assert.ok(r.highTicketPriceThreshold > 0);
        assert.ok(r.alertCooldownMinutes >= 0);
    }
});

testWithDb("tryClaimDeveloperAlertCooldown: only one of two concurrent claims for the same key succeeds", async () => {
    const key = `test-cooldown:${uniqueSuffix()}`;
    try {
        const [a, b] = await Promise.all([tryClaimDeveloperAlertCooldown(key, 60), tryClaimDeveloperAlertCooldown(key, 60)]);
        const claimedCount = [a, b].filter(Boolean).length;
        assert.equal(claimedCount, 1, "exactamente uno de los dos claims concurrentes debe ganar, nunca los dos ni ninguno");

        // Reclamar de nuevo inmediatamente (dentro del cooldown) debe fallar.
        const third = await tryClaimDeveloperAlertCooldown(key, 60);
        assert.equal(third, false);
    } finally {
        await prisma.developerAlertCooldown.deleteMany({ where: { key } });
    }
});

testWithDb("tryClaimDeveloperAlertCooldown: a claim succeeds again once the cooldown window has passed", async () => {
    const key = `test-cooldown-expired:${uniqueSuffix()}`;
    try {
        const first = await tryClaimDeveloperAlertCooldown(key, 60);
        assert.equal(first, true);

        // Simula que el cooldown ya venció, sin esperar 60 minutos reales.
        await prisma.developerAlertCooldown.update({ where: { key }, data: { lastFiredAt: new Date(Date.now() - 61 * 60 * 1000) } });

        const second = await tryClaimDeveloperAlertCooldown(key, 60);
        assert.equal(second, true);
    } finally {
        await prisma.developerAlertCooldown.deleteMany({ where: { key } });
    }
});

testWithDb("tryClaimDeveloperAlertCooldown: cooldownMinutes <= 0 always claims (no cooldown)", async () => {
    const key = `test-cooldown-disabled:${uniqueSuffix()}`;
    try {
        const first = await tryClaimDeveloperAlertCooldown(key, 0);
        const second = await tryClaimDeveloperAlertCooldown(key, 0);
        assert.equal(first, true);
        assert.equal(second, true);
    } finally {
        await prisma.developerAlertCooldown.deleteMany({ where: { key } });
    }
});
