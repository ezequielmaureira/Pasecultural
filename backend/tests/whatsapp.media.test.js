import test from "node:test";
import assert from "node:assert/strict";
import { fetchWhatsappMediaMetadata, downloadWhatsappMedia } from "../src/services/whatsapp.service.js";

// Bug fix (carga de imagen del evento) — fetchWhatsappMediaMetadata/
// downloadWhatsappMedia son los dos únicos puntos nuevos que hablan con la
// Meta Media API. Mismo criterio de mock que whatsapp.send.test.js
// (mockFetchOnce sobre globalThis.fetch, sin librerías de mocking) y mismo
// cuidado con el cacheo LAZY de las 3 variables de entorno: el test que
// necesita variables "limpias" corre primero.

function mockFetchOnce(handler) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = originalFetch;
    };
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: { get: () => null },
    };
}

function setWhatsappEnv() {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1242890615575090";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v26.0";
}

// ==================================================
// fetchWhatsappMediaMetadata — GET /{version}/{mediaId}
// ==================================================

test("fetchWhatsappMediaMetadata builds the correct URL (usando WHATSAPP_GRAPH_API_VERSION, sin hardcodear otra) and sends the Bearer token", async () => {
    setWhatsappEnv();
    let capturedUrl;
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return jsonResponse(200, { url: "https://lookaside.fbsbx.com/temp/media-1", mime_type: "image/jpeg", file_size: 12345, id: "media-1" });
    });

    let result;
    try {
        result = await fetchWhatsappMediaMetadata("media-1");
    } finally {
        restore();
    }

    assert.equal(capturedUrl, "https://graph.facebook.com/v26.0/media-1");
    assert.equal(capturedOptions.headers.Authorization, "Bearer test-access-token");
    assert.deepEqual(result, {
        success: true,
        url: "https://lookaside.fbsbx.com/temp/media-1",
        mimeType: "image/jpeg",
        fileSize: 12345,
        error: null,
    });
});

test("fetchWhatsappMediaMetadata returns a controlled error when Meta rejects the media id", async () => {
    setWhatsappEnv();
    const restore = mockFetchOnce(async () => jsonResponse(400, { error: { message: "Unsupported get request." } }));

    let result;
    try {
        result = await fetchWhatsappMediaMetadata("bad-media-id");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.url, null);
    assert.equal(result.error, "Unsupported get request.");
});

test("fetchWhatsappMediaMetadata returns a controlled error on a network failure, never throws", async () => {
    setWhatsappEnv();
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let result;
    try {
        result = await fetchWhatsappMediaMetadata("media-1");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "NETWORK_ERROR");
});

// ==================================================
// downloadWhatsappMedia — GET a la URL temporal, misma autorización
// ==================================================

test("downloadWhatsappMedia sends the same Bearer token to the temporary Meta URL and returns the bytes", async () => {
    setWhatsappEnv();
    const fakeBytes = new TextEncoder().encode("fake-image-bytes").buffer;
    let capturedUrl;
    let capturedOptions;
    const restore = mockFetchOnce(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => fakeBytes,
            headers: { get: (name) => (name === "content-type" ? "image/jpeg" : null) },
        };
    });

    let result;
    try {
        result = await downloadWhatsappMedia("https://lookaside.fbsbx.com/temp/media-1");
    } finally {
        restore();
    }

    assert.equal(capturedUrl, "https://lookaside.fbsbx.com/temp/media-1");
    assert.equal(capturedOptions.headers.Authorization, "Bearer test-access-token");
    assert.equal(result.success, true);
    assert.equal(result.contentType, "image/jpeg");
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.buffer.toString(), "fake-image-bytes");
});

test("downloadWhatsappMedia returns a controlled error when the download fails", async () => {
    setWhatsappEnv();
    const restore = mockFetchOnce(async () => ({ ok: false, status: 403, headers: { get: () => null } }));

    let result;
    try {
        result = await downloadWhatsappMedia("https://lookaside.fbsbx.com/temp/media-1");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.buffer, null);
    assert.equal(result.error, "HTTP_403");
});

test("downloadWhatsappMedia returns a controlled error on a network failure, never throws", async () => {
    setWhatsappEnv();
    const restore = mockFetchOnce(async () => {
        throw new Error("fetch failed");
    });

    let result;
    try {
        result = await downloadWhatsappMedia("https://lookaside.fbsbx.com/temp/media-1");
    } finally {
        restore();
    }

    assert.equal(result.success, false);
    assert.equal(result.error, "NETWORK_ERROR");
});

// ==================================================
// Seguridad — el WHATSAPP_ACCESS_TOKEN nunca aparece en ningún resultado
// devuelto por estas dos funciones (sólo viaja en el header Authorization
// de cada fetch, nunca en el valor de retorno).
// ==================================================

test("neither fetchWhatsappMediaMetadata nor downloadWhatsappMedia ever leak the access token in their return value", async () => {
    setWhatsappEnv();
    const restoreMeta = mockFetchOnce(async () => jsonResponse(200, { url: "https://lookaside.fbsbx.com/temp/media-1", mime_type: "image/jpeg", file_size: 100 }));
    let metadataResult;
    try {
        metadataResult = await fetchWhatsappMediaMetadata("media-1");
    } finally {
        restoreMeta();
    }
    assert.ok(!JSON.stringify(metadataResult).includes("test-access-token"));

    const restoreDownload = mockFetchOnce(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
        headers: { get: () => "image/jpeg" },
    }));
    let downloadResult;
    try {
        downloadResult = await downloadWhatsappMedia("https://lookaside.fbsbx.com/temp/media-1");
    } finally {
        restoreDownload();
    }
    assert.ok(!("accessToken" in downloadResult) && !("token" in downloadResult));
});
