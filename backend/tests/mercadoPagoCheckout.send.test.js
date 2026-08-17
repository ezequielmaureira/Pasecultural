import test from "node:test";
import assert from "node:assert/strict";
import { createMercadoPagoPreference } from "../src/services/mercadoPago.service.js";

// MP-2 — createMercadoPagoPreference en aislamiento: sin DB, Mercado Pago
// siempre mockeado vía globalThis.fetch (mismo patrón que
// mercadoPago.send.test.js de MP-1).

function mockFetchOnce(handler) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SAMPLE_ITEMS = [{ id: "tt_1", title: "General", quantity: 2, unit_price: 5000, currency_id: "ARS" }];

test("createMercadoPagoPreference posts the correct request to the official preferences endpoint, using the SELLER's access_token", async () => {
    let capturedUrl;
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return jsonResponse(201, {
            id: "PREF-123",
            init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-123",
        });
    });

    let result;
    try {
        result = await createMercadoPagoPreference({
            accessToken: "SELLER-ACCESS-TOKEN",
            items: SAMPLE_ITEMS,
            payer: { name: "Nadia", surname: "Comprador", email: "nadia@example.com" },
            externalReference: "SALE-TOKEN-abc",
            marketplaceFee: 1000,
            backUrls: { success: "https://x/success", pending: "https://x/pending", failure: "https://x/failure" },
            notificationUrl: "https://api.example.com/webhook",
        });
    } finally {
        restore();
    }

    assert.equal(capturedUrl, "https://api.mercadopago.com/checkout/preferences");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
    assert.equal(capturedOptions.headers.Authorization, "Bearer SELLER-ACCESS-TOKEN");

    const body = JSON.parse(capturedOptions.body);
    assert.deepEqual(body.items, SAMPLE_ITEMS);
    assert.equal(body.external_reference, "SALE-TOKEN-abc");
    assert.equal(body.marketplace_fee, 1000);
    assert.equal(body.auto_return, "approved");
    assert.deepEqual(body.back_urls, { success: "https://x/success", pending: "https://x/pending", failure: "https://x/failure" });
    assert.equal(body.notification_url, "https://api.example.com/webhook");

    assert.deepEqual(result, {
        success: true,
        preferenceId: "PREF-123",
        initPoint: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-123",
    });
});

test("createMercadoPagoPreference: marketplace_fee travels as an absolute amount, never a percentage", async () => {
    let capturedBody;
    const restore = mockFetchOnce(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return jsonResponse(201, { id: "PREF", init_point: "https://mp/checkout" });
    });
    try {
        await createMercadoPagoPreference({
            accessToken: "T",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000, // 10% de 10000, NUNCA "10"
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restore();
    }
    assert.equal(capturedBody.marketplace_fee, 1000);
});

test("createMercadoPagoPreference: a Mercado Pago rejection fails in a controlled way", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(400, { message: "invalid access_token" }));
    let result;
    try {
        result = await createMercadoPagoPreference({
            accessToken: "BAD",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restore();
    }
    assert.equal(result.success, false);
    assert.equal(result.error, "invalid access_token");
});

test("createMercadoPagoPreference: a 5xx from Mercado Pago fails in a controlled way", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(500, {}));
    let result;
    try {
        result = await createMercadoPagoPreference({
            accessToken: "T",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restore();
    }
    assert.equal(result.success, false);
    assert.equal(result.error, "HTTP_500");
});

test("createMercadoPagoPreference: a network error fails in a controlled way", async () => {
    const restore = mockFetchOnce(async () => {
        throw new Error("ECONNRESET");
    });
    let result;
    try {
        result = await createMercadoPagoPreference({
            accessToken: "T",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restore();
    }
    assert.equal(result.success, false);
    assert.equal(result.error, "NETWORK_ERROR");
});

test("createMercadoPagoPreference: a 2xx response missing id/init_point is treated as a failure", async () => {
    const restore = mockFetchOnce(async () => jsonResponse(201, { id: "PREF-123" }));
    let result;
    try {
        result = await createMercadoPagoPreference({
            accessToken: "T",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restore();
    }
    assert.equal(result.success, false);
    assert.equal(result.error, "INCOMPLETE_PREFERENCE_RESPONSE");
});

test("createMercadoPagoPreference: no successful or failed result ever leaks the access_token", async () => {
    const restoreOk = mockFetchOnce(async () => jsonResponse(201, { id: "PREF", init_point: "https://mp/checkout" }));
    let okResult;
    try {
        okResult = await createMercadoPagoPreference({
            accessToken: "SECRET-TOKEN-VALUE",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restoreOk();
    }
    assert.ok(!JSON.stringify(okResult).includes("SECRET-TOKEN-VALUE"));

    const restoreFail = mockFetchOnce(async () => jsonResponse(401, { message: "unauthorized" }));
    let failResult;
    try {
        failResult = await createMercadoPagoPreference({
            accessToken: "SECRET-TOKEN-VALUE-2",
            items: SAMPLE_ITEMS,
            payer: {},
            externalReference: "ref",
            marketplaceFee: 1000,
            backUrls: { success: "s", pending: "p", failure: "f" },
        });
    } finally {
        restoreFail();
    }
    assert.ok(!JSON.stringify(failResult).includes("SECRET-TOKEN-VALUE-2"));
});
