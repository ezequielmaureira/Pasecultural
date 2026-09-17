import test from "node:test";
import assert from "node:assert/strict";
import cloudinary from "../src/config/cloudinary.js";
import { uploadImageService, uploadVideoService, CLOUDINARY_UPLOAD_TIMEOUT_MS } from "../src/services/media.service.js";

// Diagnóstico 2026-09-17 — un JPEG mínimo válido subido directo desde la VM
// de Fly también terminó en TimeoutError/http_code 499 de Cloudinary. Este
// test sólo confirma que uploadImageService/uploadVideoService configuran
// `timeout` en las options que le pasan a upload_stream — nunca pega a la
// red real. cloudinary.uploader es el mismo singleton mutable que usa
// media.service.js (no hay DI acá), así que se reemplaza upload_stream
// temporalmente para capturar las options, y se restaura siempre en
// `finally` para no afectar otros tests del proceso.
test("uploadImageService configura timeout en las options de upload_stream", async () => {
    const original = cloudinary.uploader.upload_stream;
    let capturedOptions;
    cloudinary.uploader.upload_stream = (options, callback) => {
        capturedOptions = options;
        callback(null, { secure_url: "https://example.test/img.jpg", public_id: "pasecultural/x" });
        return { end: () => {} };
    };

    try {
        await uploadImageService(Buffer.from("fake"));
    } finally {
        cloudinary.uploader.upload_stream = original;
    }

    assert.equal(capturedOptions.resource_type, "image");
    assert.equal(capturedOptions.folder, "pasecultural");
    assert.equal(capturedOptions.timeout, 30000);
    assert.equal(capturedOptions.timeout, CLOUDINARY_UPLOAD_TIMEOUT_MS);
});

test("uploadVideoService configura timeout en las options de upload_stream", async () => {
    const original = cloudinary.uploader.upload_stream;
    let capturedOptions;
    cloudinary.uploader.upload_stream = (options, callback) => {
        capturedOptions = options;
        callback(null, { secure_url: "https://example.test/vid.mp4", public_id: "pasecultural/y", duration: 5 });
        return { end: () => {} };
    };

    try {
        await uploadVideoService(Buffer.from("fake"));
    } finally {
        cloudinary.uploader.upload_stream = original;
    }

    assert.equal(capturedOptions.resource_type, "video");
    assert.equal(capturedOptions.folder, "pasecultural");
    assert.equal(capturedOptions.timeout, 30000);
    assert.equal(capturedOptions.timeout, CLOUDINARY_UPLOAD_TIMEOUT_MS);
});
