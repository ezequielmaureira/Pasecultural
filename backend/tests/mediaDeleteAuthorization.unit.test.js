import test from "node:test";
import assert from "node:assert/strict";
import { deleteMediaForUserService, isManagedPublicId, UPLOADER_CONTEXT_KEY } from "../src/services/media.service.js";

// C3 — autorización de DELETE /api/media/*publicId. Sin red ni Cloudinary
// real: fetchResource/destroy se inyectan (ver deleteMediaForUserService).

const organizerA = { id: "user_a", role: "ORGANIZER" };
const organizerB = { id: "user_b", role: "ORGANIZER" };
const developer = { id: "user_dev", role: "DEVELOPER" };

function fakeCloudinary(resources) {
    const destroyed = [];
    return {
        destroyed,
        deps: {
            fetchResource: async (publicId) => resources[publicId] ?? null,
            destroy: async (publicId, type) => {
                destroyed.push({ publicId, type });
                return { result: "ok" };
            },
        },
    };
}

const ownedByA = { context: { custom: { [UPLOADER_CONTEXT_KEY]: "user_a" } } };
const legacy = { context: undefined };

async function expectCode(promise, code) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.code, code);
        return true;
    });
}

test("MEDIA-A: el dueño borra su propia imagen", async () => {
    const cdn = fakeCloudinary({ "pasecultural/abc123": ownedByA });
    const result = await deleteMediaForUserService(organizerA, "pasecultural/abc123", "image", cdn.deps);
    assert.equal(result.result, "ok");
    assert.deepEqual(cdn.destroyed, [{ publicId: "pasecultural/abc123", type: "image" }]);
});

test("MEDIA-B: otro organizador NO puede borrar la imagen ajena (403) y no se llama a destroy", async () => {
    const cdn = fakeCloudinary({ "pasecultural/abc123": ownedByA });
    await expectCode(deleteMediaForUserService(organizerB, "pasecultural/abc123", "image", cdn.deps), "MEDIA_FORBIDDEN");
    assert.equal(cdn.destroyed.length, 0);
});

test("MEDIA-C: un archivo viejo sin dueño registrado sólo lo borra DEVELOPER", async () => {
    const cdn = fakeCloudinary({ "pasecultural/legacy1": legacy });
    await expectCode(deleteMediaForUserService(organizerA, "pasecultural/legacy1", "image", cdn.deps), "MEDIA_FORBIDDEN");
    assert.equal(cdn.destroyed.length, 0);
    const result = await deleteMediaForUserService(developer, "pasecultural/legacy1", "image", cdn.deps);
    assert.equal(result.result, "ok");
});

test("MEDIA-D: DEVELOPER borra cualquier recurso de la carpeta, también videos", async () => {
    const cdn = fakeCloudinary({ "pasecultural/vid1": ownedByA });
    await deleteMediaForUserService(developer, "pasecultural/vid1", "video", cdn.deps);
    assert.deepEqual(cdn.destroyed, [{ publicId: "pasecultural/vid1", type: "video" }]);
});

test("MEDIA-E: publicIds manipulados o fuera de la carpeta se rechazan (400) — ni siquiera DEVELOPER", async () => {
    const cdn = fakeCloudinary({});
    for (const publicId of [
        "otra-carpeta/abc",
        "pasecultural",
        "pasecultural/",
        "pasecultural/../otra/abc",
        "pasecultural/abc.jpg",
        "pasecultural/a b",
        "pasecultural/*",
        "../pasecultural/abc",
        `pasecultural/${"a".repeat(300)}`,
        "",
        null,
    ]) {
        await expectCode(deleteMediaForUserService(developer, publicId, "image", cdn.deps), "MEDIA_INVALID_ID");
    }
    await expectCode(deleteMediaForUserService(developer, "pasecultural/abc", "raw", cdn.deps), "MEDIA_INVALID_ID");
    assert.equal(cdn.destroyed.length, 0);
});

test("MEDIA-F: sin fila User (sesión de Clerk sin sincronizar) no se borra nada", async () => {
    const cdn = fakeCloudinary({ "pasecultural/abc123": ownedByA });
    await expectCode(deleteMediaForUserService(null, "pasecultural/abc123", "image", cdn.deps), "USER_NOT_FOUND");
    assert.equal(cdn.destroyed.length, 0);
});

test("MEDIA-G: recurso inexistente => 'not found' sin llamar a destroy (misma respuesta para cualquiera)", async () => {
    const cdn = fakeCloudinary({});
    const result = await deleteMediaForUserService(organizerB, "pasecultural/nope", "image", cdn.deps);
    assert.equal(result.result, "not found");
    assert.equal(cdn.destroyed.length, 0);
});

test("MEDIA-H: isManagedPublicId acepta los publicIds que genera Cloudinary en la carpeta", () => {
    assert.equal(isManagedPublicId("pasecultural/kz1xq9abcd_efg-12"), true);
    assert.equal(isManagedPublicId("pasecultural/sub/abc"), true);
});
