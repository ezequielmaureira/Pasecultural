// node --test tests/ — overlay de compra vs. redirección a Mercado Pago.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublishRunner } from "../src/hooks/publishRunner.js";
import { redirectToCheckout } from "../src/lib/payment/checkoutRedirect.js";

function makeRunner({ timeoutMs = 50, pollAttempts = 2, pollIntervalMs = 5 } = {}) {
  const calls = [];
  const runner = createPublishRunner({
    setPublishing: (v) => calls.push(["publishing", v]),
    setCheckingOutcome: (v) => calls.push(["checking", v]),
    timeoutMs,
    pollAttempts,
    pollIntervalMs,
  });
  const publishing = () => calls.filter(([k]) => k === "publishing").map(([, v]) => v);
  return { runner, calls, publishing };
}

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test("CHK-A: éxito rápido con keepPublishingOnSuccess => publishing queda en true (nunca false)", async () => {
  const { runner, publishing } = makeRunner();
  const result = await runner.run(async () => ({ checkoutUrl: "https://mp.example/x" }), {
    checkOutcome: async () => null,
    keepPublishingOnSuccess: true,
  });
  assert.equal(result.checkoutUrl, "https://mp.example/x");
  assert.deepEqual(publishing(), [true]);
});

test("CHK-B: respuesta lenta pero dentro del timeout => overlay sigue abierto", async () => {
  const { runner, publishing } = makeRunner({ timeoutMs: 200 });
  await runner.run(() => delay(80, { checkoutUrl: "https://mp.example/x" }), {
    checkOutcome: async () => null,
    keepPublishingOnSuccess: true,
  });
  assert.deepEqual(publishing(), [true]);
});

test("CHK-C: timeout recuperado por checkOutcome => overlay sigue abierto", async () => {
  const { runner, publishing } = makeRunner({ timeoutMs: 10 });
  const result = await runner.run(() => delay(1000, null), {
    checkOutcome: async () => ({ checkoutUrl: "https://mp.example/recovered" }),
    keepPublishingOnSuccess: true,
  });
  assert.equal(result.checkoutUrl, "https://mp.example/recovered");
  assert.deepEqual(publishing(), [true]);
});

test("CHK-D: error del checkout => publishing vuelve a false aun con keepPublishingOnSuccess", async () => {
  const { runner, publishing } = makeRunner();
  await assert.rejects(
    runner.run(async () => { throw new Error("MERCADOPAGO_PREFERENCE_FAILED"); }, {
      checkOutcome: async () => null,
      keepPublishingOnSuccess: true,
    }),
    /MERCADOPAGO_PREFERENCE_FAILED/
  );
  assert.deepEqual(publishing(), [true, false]);
});

test("CHK-E: timeout sin resultado => error unresolved y publishing false", async () => {
  const { runner, publishing } = makeRunner({ timeoutMs: 10 });
  await assert.rejects(
    runner.run(() => delay(1000, null), { checkOutcome: async () => null, keepPublishingOnSuccess: true }),
    (err) => err.unresolved === true
  );
  assert.deepEqual(publishing(), [true, false]);
});

test("CHK-F: sin la opción (publicar eventos) el comportamiento no cambia: false al terminar", async () => {
  const { runner, publishing } = makeRunner();
  await runner.run(async () => ({ id: "evt" }), { checkOutcome: async () => null });
  assert.deepEqual(publishing(), [true, false]);
});

test("CHK-G: redirectToCheckout navega con la URL y falla si no hay checkoutUrl", () => {
  const visited = [];
  redirectToCheckout({ checkoutUrl: "https://mp.example/x" }, (url) => visited.push(url));
  assert.deepEqual(visited, ["https://mp.example/x"]);
  assert.throws(() => redirectToCheckout({}, (url) => visited.push(url)), /Mercado Pago/);
  assert.throws(() => redirectToCheckout(undefined, (url) => visited.push(url)));
  assert.equal(visited.length, 1);
});
