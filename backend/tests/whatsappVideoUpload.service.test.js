import test from "node:test";
import assert from "node:assert/strict";
import { uploadWhatsappVideoMessage } from "../src/services/whatsappMediaUpload.service.js";

// Fest Pass — mismo criterio DI que whatsappMediaUpload.service.test.js
// (imagen): todas las dependencias reales se inyectan como mocks, sin
// tocar red, Meta ni Cloudinary real. Cubre además el chequeo EXCLUSIVO de
// video (duración real post-upload) que la imagen no tiene.

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

const VALID_METADATA = { success: true, url: "https://lookaside.fbsbx.com/temp/media-1", mimeType: "video/mp4", fileSize: 1024, error: null };
const SMALL_BUFFER = Buffer.from("fake-video-bytes");
const VALID_UPLOAD = { secure_url: "https://res.cloudinary.com/pasecultural/video/upload/v1/pasecultural/abc123.mp4", public_id: "pasecultural/abc123", duration: 12.3 };

function baseDeps(overrides = {}) {
    return {
        getMetadata: spy(VALID_METADATA),
        downloadMedia: spy({ success: true, buffer: SMALL_BUFFER, contentType: "video/mp4", error: null }),
        uploadToCloudinary: spy(VALID_UPLOAD),
        deleteFromCloudinary: spy({ result: "ok" }),
        ...overrides,
    };
}

test("a valid video within the duration limit is uploaded and returns url/publicId/duration", async () => {
    const deps = baseDeps();

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.equal(deps.getMetadata.calls.length, 1);
    assert.deepEqual(deps.getMetadata.calls[0], ["media-1"]);
    assert.equal(deps.downloadMedia.calls.length, 1);
    assert.equal(deps.uploadToCloudinary.calls.length, 1);
    assert.equal(deps.uploadToCloudinary.calls[0][0], SMALL_BUFFER);
    assert.deepEqual(result, { success: true, url: VALID_UPLOAD.secure_url, publicId: VALID_UPLOAD.public_id, duration: 12.3 });
    assert.equal(deps.deleteFromCloudinary.calls.length, 0);
});

test("missing mediaId is rejected before calling anything", async () => {
    const deps = baseDeps();

    const result = await uploadWhatsappVideoMessage(null, deps);

    assert.deepEqual(result, { success: false, reason: "MISSING_MEDIA_ID" });
    assert.equal(deps.getMetadata.calls.length, 0);
});

test("Meta metadata failure never reaches download or Cloudinary", async () => {
    const deps = baseDeps({ getMetadata: spy({ success: false, url: null, mimeType: null, fileSize: null, error: "HTTP_400" }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "META_METADATA_ERROR" });
    assert.equal(deps.downloadMedia.calls.length, 0);
});

test("an invalid MIME type reported by Meta's metadata is rejected without downloading", async () => {
    const deps = baseDeps({ getMetadata: spy({ ...VALID_METADATA, mimeType: "video/x-flv" }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "INVALID_MIME_TYPE" });
    assert.equal(deps.downloadMedia.calls.length, 0);
});

test("a file size over 100MB reported by Meta's metadata is rejected without downloading", async () => {
    const deps = baseDeps({ getMetadata: spy({ ...VALID_METADATA, fileSize: 101 * 1024 * 1024 }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "FILE_TOO_LARGE" });
    assert.equal(deps.downloadMedia.calls.length, 0);
});

test("Meta download failure never reaches Cloudinary", async () => {
    const deps = baseDeps({ downloadMedia: spy({ success: false, buffer: null, contentType: null, error: "HTTP_403" }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "META_DOWNLOAD_ERROR" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("the real downloaded bytes are re-validated by size (>100MB), even if metadata said otherwise", async () => {
    const oversizedBuffer = Buffer.alloc(101 * 1024 * 1024);
    const deps = baseDeps({ downloadMedia: spy({ success: true, buffer: oversizedBuffer, contentType: "video/mp4", error: null }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "FILE_TOO_LARGE" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("the real downloaded content-type is re-validated, even if metadata said it was valid", async () => {
    const deps = baseDeps({ downloadMedia: spy({ success: true, buffer: SMALL_BUFFER, contentType: "video/x-flv", error: null }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "INVALID_MIME_TYPE" });
    assert.equal(deps.uploadToCloudinary.calls.length, 0);
});

test("a Cloudinary rejection (throw) never advances and returns a controlled error", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy(new Error("cloudinary boom")) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "CLOUDINARY_ERROR" });
    assert.equal(deps.deleteFromCloudinary.calls.length, 0);
});

test("a Cloudinary response without secure_url/public_id is treated as a failure", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy({ duration: 5 }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "CLOUDINARY_ERROR" });
});

test("a video longer than 30 seconds (Cloudinary's real duration) is rejected and deleted from Cloudinary", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy({ ...VALID_UPLOAD, duration: 45 }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "VIDEO_TOO_LONG" });
    assert.equal(deps.deleteFromCloudinary.calls.length, 1);
    assert.deepEqual(deps.deleteFromCloudinary.calls[0], [VALID_UPLOAD.public_id]);
});

test("a video of exactly 30 seconds is accepted (limit is inclusive)", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy({ ...VALID_UPLOAD, duration: 30 }) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.equal(result.success, true);
    assert.equal(deps.deleteFromCloudinary.calls.length, 0);
});

test("if deleting the too-long video from Cloudinary itself fails, VIDEO_TOO_LONG is still returned (never a crash)", async () => {
    const deps = baseDeps({ uploadToCloudinary: spy({ ...VALID_UPLOAD, duration: 45 }), deleteFromCloudinary: spy(new Error("delete boom")) });

    const result = await uploadWhatsappVideoMessage("media-1", deps);

    assert.deepEqual(result, { success: false, reason: "VIDEO_TOO_LONG" });
});
