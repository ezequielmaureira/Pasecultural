import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../src/middlewares/rateLimit.js";

// Auditoría "endurecer webhook" — se prueba el mismo windowMs/max
// configurados para POST /api/mercadopago/webhook (ver mercadoPago.routes.js:
// 180 requests/minuto por IP) contra el middleware rateLimit() de forma
// aislada, sin Express real y sin tocar Prisma — importar el router
// completo arrastraría @prisma/client transitivamente (vía el controller
// y el service) sólo para probar aritmética de un contador en memoria.
// Pura, sin DB — mismo criterio que platformFee.test.js.

function fakeReq(ip) {
    return { ip };
}

function fakeRes() {
    const state = { statusCode: undefined, jsonBody: undefined };
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(payload) {
            state.jsonBody = payload;
            return res;
        },
    };
    return { res, state };
}

test("a normal burst of legitimate webhook traffic (well under the limit) is never rate-limited", () => {
    const limiter = rateLimit({ windowMs: 60 * 1000, max: 180 });
    let nextCalls = 0;
    for (let i = 0; i < 50; i += 1) {
        const { res } = fakeRes();
        limiter(fakeReq("200.1.2.3"), res, () => {
            nextCalls += 1;
        });
    }
    assert.equal(nextCalls, 50, "una ráfaga normal de notificaciones legítimas (varias compras, retries) nunca debe frenarse");
});

test("sustained abuse from a single IP past the configured limit gets 429, without ever touching a different IP's counter", () => {
    const limiter = rateLimit({ windowMs: 60 * 1000, max: 180 });
    let blocked = 0;
    let passed = 0;
    for (let i = 0; i < 200; i += 1) {
        const { res, state } = fakeRes();
        limiter(fakeReq("9.9.9.9"), res, () => {
            passed += 1;
        });
        if (state.statusCode === 429) blocked += 1;
    }
    assert.equal(passed, 180, "las primeras 180 requests de esa IP en la ventana deben pasar");
    assert.equal(blocked, 20, "las siguientes 20 (de 200) deben responder 429");

    // Otra IP, en la misma ventana, tiene su propio contador — el abuso de
    // la primera IP nunca la afecta (mismo mecanismo que ya usan
    // scannerAuth.routes.js/sale.routes.js: key = `${limiterId}:${ip}`).
    const { res: resOther, state: stateOther } = fakeRes();
    let otherPassed = false;
    limiter(fakeReq("10.10.10.10"), resOther, () => {
        otherPassed = true;
    });
    assert.equal(otherPassed, true, "una IP distinta no debe verse afectada por el abuso de otra");
    assert.equal(stateOther.statusCode, undefined);
});

test("the 429 response never leaks internal details (no secret/signature/token in the message)", () => {
    const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, message: "Too many requests." });
    const { res: first } = fakeRes();
    limiter(fakeReq("5.5.5.5"), first, () => {});

    const { res: second, state } = fakeRes();
    limiter(fakeReq("5.5.5.5"), second, () => {});

    assert.equal(state.statusCode, 429);
    assert.deepEqual(state.jsonBody, { message: "Too many requests." });
});
