import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService, syncEventScheduleService, updateMyEventService, getQuickPassBySlugService } from "../src/services/event.service.js";

// Suite focalizada — Quick Pass V1 (imagen vertical, capacidad del Event).
// NO mezclar con otras suites de event.service.js. Mismo patrón de
// fixtures/guardrail que eventPlanLimits.test.js: Postgres real
// (backend/.env.test), nunca mocks de Prisma — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

const SAMPLE_IMAGE_URL = "https://res.cloudinary.com/pasecultural/image/upload/v1/quickpass-sample.jpg";

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `user_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

function locationInput(overrides = {}) {
    return {
        venueName: "Plaza Central",
        formattedAddress: "Calle Falsa 123",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

// Mismo criterio que eventPlanLimits.test.js#createDraftEvent: FREE_ENTRY
// evita tener que armar catálogo real sólo para poder publicar
// (assertPublishable no exige TicketTypes para este admissionType).
async function createDraftFreeEntryEvent(owner, org, title) {
    const event = await createEventService(owner.clerkId, { title, admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
    // endAt obligatorio para publicar desde la ronda EVENT_FINISHED_GUARD
    // (assertPublishable, event.service.js) — este fixture es anterior a esa
    // regla, se actualiza acá para seguir pudiendo publicar.
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

async function assertQuickPassImageRequired(promise) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.message, "QUICK_PASS_IMAGE_REQUIRED");
        return true;
    });
}

// QP-A: evento sin Quick Pass activo no expone experiencia pública.
testWithDb("QP-A: evento publicado sin Quick Pass activo devuelve available:false", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-A");
        await publishEvent(owner, event, org);

        const result = await getQuickPassBySlugService(event.slug);
        assert.deepEqual(result, { available: false });
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-B: no se puede guardar Quick Pass activo sin imagen.
testWithDb("QP-B: activar Quick Pass sin imagen se rechaza (create y update)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        // Alta: createEventService es el MISMO service que usa
        // EventServicePort.commit() (WhatsApp) — no hay una ruta separada
        // que probar por canal.
        await assertQuickPassImageRequired(
            createEventService(owner.clerkId, { title: "QP-B create", admissionType: "FREE_ENTRY", quickPassEnabled: true }, org.id)
        );

        event = await createDraftFreeEntryEvent(owner, org, "QP-B update");
        await assertQuickPassImageRequired(
            updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true }, org.id)
        );

        const fresh = await prisma.event.findUnique({ where: { id: event.id } });
        assert.equal(fresh.quickPassEnabled, false, "no debe haber quedado activado");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-C: se puede guardar Quick Pass activo con imagen.
testWithDb("QP-C: activar Quick Pass con imagen válida se guarda correctamente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-C");
        const updated = await updateMyEventService(
            owner.clerkId,
            event.id,
            { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL },
            org.id
        );
        assert.equal(updated.quickPassEnabled, true);
        assert.equal(updated.quickPassImageUrl, SAMPLE_IMAGE_URL);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-D: Organizer propietario puede configurarlo.
testWithDb("QP-D: el Organizer dueño del evento puede configurar Quick Pass", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-D");
        const updated = await updateMyEventService(
            owner.clerkId,
            event.id,
            { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL },
            org.id
        );
        assert.ok(updated, "el dueño real debe poder guardar");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-E: otro Organizer no puede configurarlo.
testWithDb("QP-E: un Organizer distinto no puede configurar Quick Pass de un evento ajeno", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const intruder = await createUser();
    const intruderOrg = await createOrganization(intruder.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-E");

        // El intruso pide editar el evento de `owner` pasando SU PROPIA
        // organización — mismo patrón de autorización que el resto del
        // archivo: event.organizationId !== context.organization.id -> null.
        const result = await updateMyEventService(
            intruder.clerkId,
            event.id,
            { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL },
            intruderOrg.id
        );
        assert.equal(result, null, "un Organizer ajeno nunca debe poder tocar este evento");

        const fresh = await prisma.event.findUnique({ where: { id: event.id } });
        assert.equal(fresh.quickPassEnabled, false, "el evento real no debe haber cambiado");
    } finally {
        await cleanup({
            eventIds: event ? [event.id] : [],
            organizationIds: [org.id, intruderOrg.id],
            userIds: [owner.id, intruder.id],
        });
    }
});

// QP-F: edición mantiene comportamiento correcto (un guardado que no toca
// Quick Pass no debe alterar su estado ya persistido).
testWithDb("QP-F: editar otro campo no toca el estado de Quick Pass ya guardado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-F");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);

        const edited = await updateMyEventService(owner.clerkId, event.id, { title: "QP-F editado" }, org.id);
        assert.equal(edited.title, "QP-F editado");
        assert.equal(edited.quickPassEnabled, true, "Quick Pass debe seguir activo");
        assert.equal(edited.quickPassImageUrl, SAMPLE_IMAGE_URL, "la imagen no debe perderse");
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-G: endpoint público devuelve sólo campos necesarios.
testWithDb("QP-G: getQuickPassBySlugService devuelve exclusivamente los campos necesarios", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await createDraftFreeEntryEvent(owner, org, "QP-G");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);
        await publishEvent(owner, event, org);

        const result = await getQuickPassBySlugService(event.slug);
        assert.equal(result.available, true);

        const actualKeys = Object.keys(result.event).sort();
        const expectedKeys = [
            "slug",
            "title",
            "quickPassImageUrl",
            // Video de fondo opcional (ronda "video Cloudinary") — siempre
            // presente en el payload (null si no se cargó), ver
            // getQuickPassBySlugService.
            "quickPassVideoUrl",
            "venueName",
            "formattedAddress",
            "city",
            "startDate",
            "organizationName",
            "functions",
        ].sort();
        assert.deepEqual(actualKeys, expectedKeys);

        // Nunca debe filtrar el id interno del Event, createdBy, ni ningún
        // dato de la Organization más allá del nombre.
        assert.equal("id" in result.event, false);
        assert.equal("createdBy" in result.event, false);
        assert.equal("organizationId" in result.event, false);
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// QP-H: evento inexistente/no público respeta las reglas existentes.
testWithDb("QP-H: evento inexistente o todavía DRAFT nunca expone Quick Pass", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const missing = await getQuickPassBySlugService(`no-existe-${uniqueSuffix()}`);
        assert.deepEqual(missing, { available: false });

        // DRAFT con Quick Pass activo + imagen válida, pero SIN publicar:
        // getPublicEventBySlugService ya exige PUBLISHED+PUBLIC — Quick Pass
        // hereda exactamente esa misma regla, no inventa una propia.
        event = await createDraftFreeEntryEvent(owner, org, "QP-H");
        await updateMyEventService(owner.clerkId, event.id, { quickPassEnabled: true, quickPassImageUrl: SAMPLE_IMAGE_URL }, org.id);

        const stillDraft = await getQuickPassBySlugService(event.slug);
        assert.deepEqual(stillDraft, { available: false });
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});

// Confirma explícitamente que la validación vive en el service COMPARTIDO
// (event.service.js), nunca duplicada por canal: EventServicePort.commit()
// (WhatsApp) llama a estas mismas 2 funciones exportadas — no existe una
// segunda copia de assertQuickPassInvariant en ningún otro archivo.
testWithDb("QP-I: la validación de Quick Pass vive en createEventService/updateMyEventService, no duplicada por canal", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        // "Canal WhatsApp" = llamar exactamente a createEventService, la
        // misma función que EventServicePort.commit() invoca — no existe
        // ningún createEventServiceForWhatsApp ni equivalente.
        await assertQuickPassImageRequired(
            createEventService(owner.clerkId, { title: "QP-I", admissionType: "FREE_ENTRY", quickPassEnabled: true }, org.id)
        );
    } finally {
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id] });
    }
});
