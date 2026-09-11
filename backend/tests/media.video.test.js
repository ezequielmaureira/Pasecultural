import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    ALLOWED_VIDEO_MIME_TYPES,
    MAX_VIDEO_FILE_SIZE,
    MAX_VIDEO_DURATION_SECONDS,
    isVideoDurationWithinLimit,
} from "../src/services/media.service.js";
import {
    createEventService,
    syncEventScheduleService,
    updateMyEventService,
    getQuickPassBySlugService,
    getMyEventByIdService,
} from "../src/services/event.service.js";

// Fest Pass — video de fondo opcional (ronda "video Cloudinary").
// 2 grupos de tests:
//  - Unitarios puros (MIME/tamaño/duración) — sin red, sin Cloudinary,
//    corren siempre (no dependen de hasDatabase).
//  - Integración contra Postgres real (backend/.env.test) para el modelo
//    Event/quickPassVideoUrl — mismo patrón que quickPass.test.js. La subida
//    real a Cloudinary (uploadVideoService) NO se testea acá: requeriría
//    credenciales reales y un archivo de video real; el contrato que sí se
//    puede probar sin red es exactamente lo que se prueba: la política de
//    validación (MIME/tamaño/duración) y que el campo persiste/viaja
//    correctamente end-to-end en el modelo de datos.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

const SAMPLE_IMAGE_URL = "https://res.cloudinary.com/pasecultural/image/upload/v1/quickpass-sample.jpg";
const SAMPLE_VIDEO_URL = "https://res.cloudinary.com/pasecultural/video/upload/v1/quickpass-sample.mp4";
const SAMPLE_VIDEO_PUBLIC_ID = "pasecultural/quickpass-sample";

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId, ...overrides },
    });
}

function locationInput(overrides = {}) {
    return { venueName: "Plaza Central", formattedAddress: "Calle Falsa 123", latitude: -33.12, longitude: -64.34, ...overrides };
}

async function createDraftFreeEntryEvent(owner, org, title) {
    const event = await createEventService(owner.clerkId, { title, admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
    await syncEventScheduleService(
        owner.clerkId,
        event.id,
        { functions: [{ date: "2099-08-25T20:00:00-03:00", endAt: "2099-08-25T23:00:00-03:00", venue: "Plaza Central" }], ticketTypes: [] },
        org.id
    );
    return event;
}

function publishEvent(owner, event, org) {
    return updateMyEventService(owner.clerkId, event.id, { status: "PUBLISHED" }, org.id);
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// 2) rechaza MIME inválido.
test("MV-01: ALLOWED_VIDEO_MIME_TYPES acepta mp4/mov/webm y rechaza cualquier otro MIME", () => {
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("video/mp4"), true);
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("video/quicktime"), true);
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("video/webm"), true);
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("image/png"), false);
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("video/x-msvideo"), false, "AVI no está en la whitelist");
    assert.equal(ALLOWED_VIDEO_MIME_TYPES.has("application/octet-stream"), false);
});

// 3) rechaza >100 MB (multer usa este límite tal cual — ver media.routes.js).
test("MV-02: MAX_VIDEO_FILE_SIZE es exactamente 100 MB", () => {
    assert.equal(MAX_VIDEO_FILE_SIZE, 100 * 1024 * 1024);
});

// 4) rechaza duración >30s — usando la metadata real que Cloudinary devuelve
// en la respuesta de upload (`result.duration`), nunca algo mandado por el
// cliente. Cubre el borde exacto (30s permitido, 30.01s rechazado) y el caso
// defensivo de duración ausente/no numérica (no debería pasar para un video
// real, pero nunca debe romper la subida si Cloudinary no la manda).
test("MV-03: isVideoDurationWithinLimit rechaza sólo por encima de 30s, inclusive en el borde", () => {
    assert.equal(MAX_VIDEO_DURATION_SECONDS, 30);
    assert.equal(isVideoDurationWithinLimit(10), true);
    assert.equal(isVideoDurationWithinLimit(30), true, "30s exactos deben permitirse");
    assert.equal(isVideoDurationWithinLimit(30.01), false, "por encima de 30s debe rechazarse");
    assert.equal(isVideoDurationWithinLimit(45), false);
    assert.equal(isVideoDurationWithinLimit(undefined), true, "duración ausente nunca bloquea la subida");
    assert.equal(isVideoDurationWithinLimit(NaN), true);
});

// 5) event sin video sigue funcionando — Quick Pass ya funcionaba antes de
// esta ronda con quickPassVideoUrl=null; el campo nuevo viaja siempre
// (null si no se cargó), nunca rompe el contrato existente.
testWithDb("MV-04: un evento sin quickPassVideoUrl sigue funcionando exactamente igual (Quick Pass sin video)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "MV-04");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);
        await publishEvent(owner, event, org);

        const result = await getQuickPassBySlugService(event.slug);
        assert.equal(result.available, true);
        assert.equal(result.event.quickPassImageUrl, SAMPLE_IMAGE_URL);
        assert.equal(result.event.quickPassVideoUrl, null, "sin video cargado, el campo debe viajar como null, nunca undefined");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 1/6) acepta un video válido (URL ya subida) y el reemplazo/eliminación no
// rompe el evento — sin pegarle a Cloudinary de verdad: se simula el
// resultado de una subida real seteando quickPassVideoUrl directamente
// (mismo campo que persiste updateMyEventService vía UPDATABLE_FIELDS),
// que es exactamente lo mismo que hace el frontend después de que
// VideoUploader.jsx recibe el `url` del endpoint real.
testWithDb("MV-05: cargar, reemplazar y eliminar el video no rompen el evento ni tocan quickPassImageUrl", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "MV-05");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);
        await publishEvent(owner, event, org);

        // 3) Cargar video — URL+publicId viajan juntos.
        const withVideo = await updateMyEventService(
            owner.clerkId,
            event.id,
            { quickPassVideoUrl: SAMPLE_VIDEO_URL, quickPassVideoPublicId: SAMPLE_VIDEO_PUBLIC_ID },
            org.id
        );
        assert.equal(withVideo.quickPassVideoUrl, SAMPLE_VIDEO_URL);
        assert.equal(withVideo.quickPassVideoPublicId, SAMPLE_VIDEO_PUBLIC_ID);
        assert.equal(withVideo.quickPassImageUrl, SAMPLE_IMAGE_URL, "cargar el video no debe tocar la imagen");
        assert.equal(withVideo.status, "PUBLISHED", "el evento sigue publicado");

        // 4) Cargar el evento existente (como hace el Organizer al reabrirlo
        // para editar) devuelve ambos campos.
        const reloaded = await getMyEventByIdService(owner.clerkId, event.id, org.id);
        assert.equal(reloaded.quickPassVideoUrl, SAMPLE_VIDEO_URL);
        assert.equal(reloaded.quickPassVideoPublicId, SAMPLE_VIDEO_PUBLIC_ID);

        // 8) El endpoint público (comprador) NUNCA expone el publicId.
        const publicWithVideo = await getQuickPassBySlugService(event.slug);
        assert.equal(publicWithVideo.event.quickPassVideoUrl, SAMPLE_VIDEO_URL);
        assert.equal(
            Object.hasOwn(publicWithVideo.event, "quickPassVideoPublicId"),
            false,
            "getQuickPassBySlugService (público) nunca debe exponer el publicId — es un dato de administración"
        );

        // 6) Reemplazar por otro video — el nuevo par URL+publicId se
        // conserva íntegro, ninguno queda mezclado con el anterior.
        const replacedUrl = "https://res.cloudinary.com/pasecultural/video/upload/v1/otro-clip.mp4";
        const replacedPublicId = "pasecultural/otro-clip";
        const replaced = await updateMyEventService(
            owner.clerkId,
            event.id,
            { quickPassVideoUrl: replacedUrl, quickPassVideoPublicId: replacedPublicId },
            org.id
        );
        assert.equal(replaced.quickPassVideoUrl, replacedUrl);
        assert.equal(replaced.quickPassVideoPublicId, replacedPublicId);

        // 5) Eliminar el video (organizador apaga/quita el video) limpia
        // AMBOS campos, nunca deja un publicId huérfano apuntando a una URL
        // que ya no existe.
        const removed = await updateMyEventService(
            owner.clerkId,
            event.id,
            { quickPassVideoUrl: null, quickPassVideoPublicId: null },
            org.id
        );
        assert.equal(removed.quickPassVideoUrl, null);
        assert.equal(removed.quickPassVideoPublicId, null);
        assert.equal(removed.quickPassImageUrl, SAMPLE_IMAGE_URL, "quitar el video nunca debe tocar la imagen obligatoria");
        assert.equal(removed.quickPassEnabled, true, "Quick Pass sigue activo — el video nunca fue una condición de assertQuickPassInvariant");

        const publicWithoutVideo = await getQuickPassBySlugService(event.slug);
        assert.equal(publicWithoutVideo.available, true, "Quick Pass sigue disponible sin video — sólo la imagen es obligatoria");
        assert.equal(publicWithoutVideo.event.quickPassVideoUrl, null);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 7) Un video "legacy" (URL cargada, pero SIN publicId — ej. si alguna vez
// se guardó desde un estado intermedio) no debe romper la edición
// posterior: sigue siendo un String? nullable normal, el Organizer puede
// seguir editando el evento y reemplazar/completar el publicId sin error.
testWithDb("MV-06: un video con quickPassVideoUrl pero sin quickPassVideoPublicId (legacy) no rompe la edición", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "MV-06");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);
        await publishEvent(owner, event, org);

        // Simula un video legacy: URL sin publicId (nunca debería pasar con
        // el frontend actual, pero el modelo lo permite — ambos son
        // nullable independientes a nivel de schema).
        await updateMyEventService(owner.clerkId, event.id, { quickPassVideoUrl: SAMPLE_VIDEO_URL }, org.id);

        const reloaded = await getMyEventByIdService(owner.clerkId, event.id, org.id);
        assert.equal(reloaded.quickPassVideoUrl, SAMPLE_VIDEO_URL);
        assert.equal(reloaded.quickPassVideoPublicId, null);

        // Completar el publicId (ej. el organizador reemplaza el video desde
        // el wizard) sigue funcionando sin error.
        const fixed = await updateMyEventService(owner.clerkId, event.id, { quickPassVideoPublicId: SAMPLE_VIDEO_PUBLIC_ID }, org.id);
        assert.equal(fixed.quickPassVideoUrl, SAMPLE_VIDEO_URL);
        assert.equal(fixed.quickPassVideoPublicId, SAMPLE_VIDEO_PUBLIC_ID);
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 1/2) ambos campos son nullable de forma independiente — ninguno exige al
// otro a nivel de schema/servicio (la relación "viajan siempre juntos" es
// una convención del frontend, ver VideoUploader.jsx, no un constraint de
// backend).
testWithDb("MV-07: quickPassVideoUrl y quickPassVideoPublicId son ambos nullable de forma independiente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "MV-07");
        const created = await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);
        assert.equal(created.quickPassVideoUrl, null);
        assert.equal(created.quickPassVideoPublicId, null);
        await publishEvent(owner, event, org);

        const stillPublished = await prisma.event.findUnique({ where: { id: event.id } });
        assert.equal(stillPublished.status, "PUBLISHED", "publicar sin ningún video sigue funcionando (imagen ya cubre la regla Fest existente)");
    } finally {
        await cleanup({ eventIds: [event.id], organizationIds: [org.id], userIds: [owner.id] });
    }
});
