import test from "node:test";
import assert from "node:assert/strict";
import { uploadWhatsappImageMessage } from "../src/services/whatsappMediaUpload.service.js";

// Bug fix (carga de imagen del evento) — orquestación Meta Media API ->
// Cloudinary. Todas las dependencias reales (getMetadata/downloadMedia/
// uploadToCloudinary) se inyectan como mocks (mismo criterio DI que el
// resto de los adaptadores de WhatsApp de este proyecto) para poder probar
// las reglas de negocio (MIME/tamaño/orden de llamadas) sin tocar red,
// Meta ni Cloudinary real.

function spy(returnValue) {
    const calls = [];
    const fn = async (...args) => {
        calls.push(args);
        if (returnValue instanceof Error) throw returnValue;
        return typeof returnValue === "function" ? returnValue(...args) : returnValue;
    };
    fn.calls = calls;
    return fn;
}

const VALID_METADATA = { success: true, url: "https://lookaside.fbsbx.com/temp/media-1", mimeType: "image/jpeg", fileSize: 1024, error: null };
const SMALL_BUFFER = Buffer.from("fake-image-bytes");

function baseDeps(overrides = {}) {
    return {
        getMetadata: spy(VALID_METADATA),
        downloadMedia: spy({ success: true, buffer: SMALL_BUFFER, contentType: "image/jpeg", error: null }),
        uploadToCloudinary: spy({ secure_url: "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/abc123.jpg", public_id: "pasecultural/abc123" }),
        ...overrides,
    };
}

test("a valid image is downloaded and uploaded to Cloudinary with the exact downloaded bytes, returning secure_url", async () => {
    const deps = baseDeps();

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.equal(deps.getMetadata.calls.length, 1);
    assert.deepEqual(deps.getMetadata.calls[0], ["media-1"]);
    assert.equal(deps.downloadMedia.calls.length, 1);
    assert.deepEqual(deps.downloadMedia.calls[0], [VALID_METADATA.url]);
    assert.equal(deps.uploadToCloudinary.calls.length, 1);
    assert.equal(deps.uploadToCloudinary.calls[0][0], SMALL_BUFFER);
    assert.deepEqual(result, { success: true, url: "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/abc123.jpg" });
});

test("never returns Meta's temporary URL as the final result — only Cloudinary's secure_url counts", async () => {
    const deps = baseDeps();
    const result = await uploadWhatsappImageMessage("media-1", deps);
    assert.notEqual(result.url, VALID_METADATA.url);
    assert.ok(result.url.startsWith("https://res.cloudinary.com/"));
});

test("missing mediaId is rejected before calling anything", async () => {
    const deps = baseDeps();

    const result = await uploadWhatsappImageMessage(null, deps);

    assert.deepEqual(result, { success: false, reason: "MISSING_MEDIA_ID" });
    assert.equal(deps.getMetadata.calls.length, 0);
});

test("Meta metadata failure never reaches download or Cloudinary", async () => {
    const deps = baseDeps({ getMetadata: spy({ success: false, url: null, mimeType: null, fileSize: null, error: "HTTP_400" }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "META_METADATA_ERROR" });
    assert.equal(deps.downloadMedia.calls.length, 0);
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("an invalid MIME type reported by Meta's metadata is rejected without downloading", async () => {
    const deps = baseDeps({ getMetadata: spy({ ...VALID_METADATA, mimeType: "application/pdf" }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "INVALID_MIME_TYPE" });
    assert.equal(deps.downloadMedia.calls.length, 0);
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("a file size over the limit reported by Meta's metadata is rejected without downloading", async () => {
    const deps = baseDeps({ getMetadata: spy({ ...VALID_METADATA, fileSize: 6 * 1024 * 1024 }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "FILE_TOO_LARGE" });
    assert.equal(deps.downloadMedia.calls.length, 0);
});

test("Meta download failure never reaches Cloudinary", async () => {
    const deps = baseDeps({ downloadMedia: spy({ success: false, buffer: null, contentType: null, error: "HTTP_403" }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "META_DOWNLOAD_ERROR" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("the real downloaded bytes are re-validated by size, even if Meta's metadata said it was within limits", async () => {
    const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024);
    const deps = baseDeps({ downloadMedia: spy({ success: true, buffer: oversizedBuffer, contentType: "image/jpeg", error: null }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "FILE_TOO_LARGE" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("the real downloaded content-type is re-validated, even if Meta's metadata said it was a valid MIME", async () => {
    const deps = baseDeps({ downloadMedia: spy({ success: true, buffer: SMALL_BUFFER, contentType: "application/pdf", error: null }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "INVALID_MIME_TYPE" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("a Cloudinary rejection (throw) never advances and returns a controlled error", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy(new Error("cloudinary boom")) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "CLOUDINARY_ERROR" });
});

test("a Cloudinary response without secure_url is treated as a failure", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy({ public_id: "pasecultural/abc123" }) });

    const result = await uploadWhatsappImageMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "CLOUDINARY_ERROR" });
});
