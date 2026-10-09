import test from "node:test";
import assert from "node:assert/strict";
import { areBackgroundJobsEnabled, runJobOnce, startBackgroundJobs, BACKGROUND_JOBS } from "../src/jobs/backgroundJobs.js";
import { isDueForEmailRetry, EMAIL_RETRY_MAX_ATTEMPTS } from "../src/services/email/retryFailedSaleConfirmationEmails.service.js";

// Tareas periódicas — sin base ni red: lease y job inyectados.

test("JOBS-A: desactivadas por default; sólo 'true' literal las enciende", () => {
    assert.equal(areBackgroundJobsEnabled({}), false);
    assert.equal(areBackgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: "false" }), false);
    assert.equal(areBackgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: "1" }), false);
    assert.equal(areBackgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: "true" }), true);
});

test("JOBS-B: startBackgroundJobs sin el flag no programa nada", () => {
    let scheduled = 0;
    const timers = startBackgroundJobs({ env: {}, setIntervalFn: () => scheduled++ });
    assert.deepEqual(timers, []);
    assert.equal(scheduled, 0);
});

test("JOBS-C: con el flag programa reconciliación y reintento de emails", () => {
    const intervals = [];
    startBackgroundJobs({ env: { BACKGROUND_JOBS_ENABLED: "true" }, setIntervalFn: (fn, ms) => intervals.push(ms) });
    assert.equal(intervals.length, BACKGROUND_JOBS.length);
    assert.deepEqual(
        BACKGROUND_JOBS.map((j) => j.name).sort(),
        ["mercadopago-reconciliation", "sale-confirmation-email-retry"]
    );
});

test("JOBS-D: sin lease (otra máquina ya la corrió) la tarea no corre", async () => {
    let runs = 0;
    const job = { name: "x", intervalMinutes: 10, run: async () => runs++ };
    const outcome = await runJobOnce(job, { claimLease: async () => false });
    assert.equal(outcome.reason, "lease_held_elsewhere");
    assert.equal(runs, 0);
});

test("JOBS-E: una corrida nunca se superpone con la anterior en el mismo proceso", async () => {
    let release;
    let runs = 0;
    const job = { name: "y", intervalMinutes: 10, run: () => { runs++; return new Promise((r) => { release = r; }); } };
    const first = runJobOnce(job, { claimLease: async () => true });
    await new Promise((r) => setImmediate(r));
    const second = await runJobOnce(job, { claimLease: async () => true });
    assert.equal(second.reason, "already_running");
    release("done");
    assert.equal((await first).ran, true);
    assert.equal(runs, 1);
});

test("JOBS-F: un error en la tarea nunca se propaga (no tira abajo el proceso) y libera el flag", async () => {
    const job = { name: "z", intervalMinutes: 10, run: async () => { throw new Error("boom"); } };
    const outcome = await runJobOnce(job, { claimLease: async () => true });
    assert.equal(outcome.reason, "error");
    assert.equal(job.running, false);
});

test("JOBS-G: el lease usa una clave por tarea y dura menos que el intervalo", async () => {
    const claims = [];
    await runJobOnce({ name: "w", intervalMinutes: 10, run: async () => null }, { claimLease: async (key, minutes) => { claims.push({ key, minutes }); return true; } });
    assert.deepEqual(claims, [{ key: "JOB_LEASE:w", minutes: 9 }]);
});

// ------------------------------------------------------------------
// Reintento de emails — cuándo toca reintentar
// ------------------------------------------------------------------

const NOW = new Date("2026-10-09T12:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

test("EMAIL-A: FAILED con espera creciente (10 min × intentos)", () => {
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: minutesAgo(5) }, NOW), false);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: minutesAgo(11) }, NOW), true);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 3, confirmationEmailLastAttemptAt: minutesAgo(25) }, NOW), false);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "FAILED", confirmationEmailAttempts: 3, confirmationEmailLastAttemptAt: minutesAgo(31) }, NOW), true);
});

test("EMAIL-B: tope de intentos", () => {
    assert.equal(
        isDueForEmailRetry({ confirmationEmailStatus: "FAILED", confirmationEmailAttempts: EMAIL_RETRY_MAX_ATTEMPTS, confirmationEmailLastAttemptAt: minutesAgo(600) }, NOW),
        false
    );
});

test("EMAIL-C: PENDING sólo después de 5 min de confirmada; SENT/SENDING nunca", () => {
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "PENDING", confirmationEmailAttempts: 0, confirmedAt: minutesAgo(2) }, NOW), false);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "PENDING", confirmationEmailAttempts: 0, confirmedAt: minutesAgo(6) }, NOW), true);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "SENT", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: minutesAgo(600) }, NOW), false);
    assert.equal(isDueForEmailRetry({ confirmationEmailStatus: "SENDING", confirmationEmailAttempts: 1, confirmationEmailLastAttemptAt: minutesAgo(600) }, NOW), false);
});
