import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";
import * as EventCreationEngine from "../src/conversation/EventCreationEngine.js";
import { createEventService, syncEventScheduleService, updateMyEventService } from "../src/services/event.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";
import { createOrganizationService } from "../src/services/organization.service.js";
import { requestOrganizationPhoneVerificationService } from "../src/services/organizationPhoneVerification.service.js";

// Premium — Fase 2C. Asistente de creación/gestión de eventos por WhatsApp
// exclusivo de Organizations PREMIUM — el resto de WhatsApp (verificación de
// teléfono, descubrimiento/selección de Organization, CANCEL) sigue igual
// para FREE. Se prueba contra Postgres real (backend/.env.test) llamando
// processInboundMessage con SÓLO `sendText` mockeado (para no pegarle a
// Meta real) — todo lo demás (startConversation/handleConversationInput/
// discoverCandidates/etc.) usa su implementación REAL contra Prisma, mismo
// criterio que eventCreationEngine.conversationStateCache.test.js. Guardrail
// centralizado — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

// String con forma de WhatsApp ID argentino, único por test — evita
// colisiones de channelRef/waId entre corridas y entre tests de este mismo
// archivo. No necesita ser un teléfono real: sólo tiene que ser estable
// dentro de un mismo test (WhatsappOrganizerLink.waId === message.from ===
// ConversationState.channelRef).
function uniqueWaId() {
    const digits = String(Math.floor(1000000 + Math.random() * 8999999));
    return `549351${digits}`;
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
    return {
        venueName: "Plaza Central",
        formattedAddress: "Calle Falsa 123",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

// Distinto de locationInput(): ese shape (formattedAddress) es el que
// espera event.service.js#buildLocationData cuando se llama createEventService
// DIRECTO (ver "Ya publicado" en WA-M). El draftEvent.location que arma el
// motor conversacional usa otro shape (`address`, no `formattedAddress`) —
// EventServicePort.js#buildLocationInput lee location.address, no
// location.formattedAddress. Necesario sólo para el draft que se le pasa a
// EventCreationEngine.handleInput en WA-M.
function draftLocationInput(overrides = {}) {
    return {
        venueName: "Plaza Central",
        address: "Calle Falsa 123",
        city: "Córdoba",
        province: "Córdoba",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

// Mismo patrón que whatsapp.organizerBot.test.js#textMessage — mensaje
// entrante mínimo aceptado por parseInboundWhatsappMessages.
function textMessage(overrides = {}) {
    return {
        messageId: `wamid.IN_${uniqueSuffix()}`,
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
        profileName: "Organizador de prueba",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

// Mismo patrón que whatsapp.organizerBot.test.js#fakeSender — captura lo
// que el controller intentaría mandar a Meta, sin pegarle a la red real.
function fakeSender(result = { success: true, messageId: "wamid.OUT1", error: null }) {
    const calls = [];
    const sendText = async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
    };
    return { sendText, calls };
}

async function cleanup({ organizationIds = [], userIds = [], channelRefs = [] }) {
    await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: { in: channelRefs } } });
    await prisma.conversationState.deleteMany({ where: { channelRef: { in: channelRefs } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Mismo patrón que organizationPhoneVerification.crud.test.js.
async function cleanupPhoneVerification({ organizationIds = [], userIds = [] }) {
    await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationPhoneVerification.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Mismo patrón que eventPlanLimits.test.js (Fase 2B) — necesario para WA-M.
// Resuelve TODOS los Event de esas Organizations al momento de limpiar
// (nunca una lista fija armada de antemano): un intento de PUBLISH
// bloqueado por Fase 2B igual deja un Event DRAFT creado por
// EventServicePort.commit ANTES de llegar al chequeo que falla (mismo
// comportamiento ya documentado en Fase 2B) — ese Event nunca es uno que el
// test haya podido conocer su id con anticipación.
async function cleanupEvents({ organizationIds = [], userIds = [] }) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } })).map(
        (e) => e.id
    );
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function snapshotPlanLimits() {
    const [free, premium] = await Promise.all([
        prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } }),
        prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } }),
    ]);
    return { FREE: free, PREMIUM: premium };
}

async function restorePlanLimits(snapshot) {
    for (const plan of ["FREE", "PREMIUM"]) {
        const original = snapshot[plan];
        if (!original) continue;
        const data = {
            maxActiveEvents: original.maxActiveEvents,
            maxCourtesiesPerEvent: original.maxCourtesiesPerEvent,
            maxScannersPerEvent: original.maxScannersPerEvent,
            updatedByUserId: original.updatedByUserId,
        };
        const current = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
        if (current) {
            await prisma.organizationPlanLimits.update({ where: { plan }, data });
        } else {
            await prisma.organizationPlanLimits.create({ data: { plan, ...data } });
        }
    }
}

function extractTokenFromDeepLink(deepLink) {
    const url = new URL(deepLink);
    const text = url.searchParams.get("text");
    const match = /^CONFIRMAR (.+)$/.exec(text ?? "");
    if (!match) throw new Error(`deep link sin token: ${deepLink}`);
    return match[1];
}

function withWhatsappDisplayNumberEnv() {
    const original = process.env.WHATSAPP_DISPLAY_PHONE_NUMBER;
    process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = "5493511234567";
    return () => {
        if (original === undefined) delete process.env.WHATSAPP_DISPLAY_PHONE_NUMBER;
        else process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = original;
    };
}

// ==================================================================
// WA-A / WA-B / WA-C — choke point 1 (caso A: candidato único).
// ==================================================================

testWithDb("WA-A: PREMIUM + candidato único puede iniciar la conversación", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const channelRef = uniqueWaId();
    await prisma.whatsappOrganizerLink.create({ data: { waId: channelRef, organizationId: org.id } });
    const { sendText, calls } = fakeSender();
    try {
        await processInboundMessage(textMessage({ from: channelRef, text: "1" }), { sendText });

        const conv = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef, status: "ACTIVE" } });
        assert.ok(conv, "debe haberse creado una ConversationState");
        assert.equal(conv.organizationId, org.id);
        assert.equal(calls.length, 1);
        assert.notEqual(calls[0].text, WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

testWithDb("WA-B: FREE + candidato único NO puede iniciar — no crea ConversationState", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const channelRef = uniqueWaId();
    await prisma.whatsappOrganizerLink.create({ data: { waId: channelRef, organizationId: org.id } });
    const { sendText } = fakeSender();
    try {
        await processInboundMessage(textMessage({ from: channelRef, text: "1" }), { sendText });

        const conv = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef } });
        assert.equal(conv, null, "no debe haberse creado ninguna ConversationState");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

testWithDb("WA-C: FREE recibe exactamente el mensaje Premium centralizado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const channelRef = uniqueWaId();
    await prisma.whatsappOrganizerLink.create({ data: { waId: channelRef, organizationId: org.id } });
    const { sendText, calls } = fakeSender();
    try {
        await processInboundMessage(textMessage({ from: channelRef, text: "1" }), { sendText });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].text, WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

// ==================================================================
// WA-D — verificación de teléfono (CONFIRMAR <token>) nunca depende del
// plan: corre antes de cualquier lógica de conversación/gate.
// ==================================================================

testWithDb("WA-D: FREE puede completar CONFIRMAR/verificación de teléfono antes del gate", async () => {
    const owner = await createUser();
    const restoreEnv = withWhatsappDisplayNumberEnv();
    const ARG_PHONE = "351 412-3456"; // normaliza a waId 5493514123456
    let organization;
    try {
        ({ organization } = await createOrganizationService(owner.clerkId, {
            name: `Sala ${uniqueSuffix()}`,
            email: `org_${uniqueSuffix()}@example.com`,
            phone: ARG_PHONE,
        }));
        assert.equal(organization.plan, "FREE", "precondición: la Organization arranca FREE por default");

        const { deepLink } = await requestOrganizationPhoneVerificationService(owner.clerkId, organization.id, ARG_PHONE);
        const token = extractTokenFromDeepLink(deepLink);
        const { sendText } = fakeSender();

        await processInboundMessage(textMessage({ from: "5493514123456", text: `CONFIRMAR ${token}` }), { sendText });

        const verified = await prisma.organization.findUnique({ where: { id: organization.id } });
        assert.ok(verified.phoneVerifiedAt, "la verificación debe completarse sin importar que la Organization sea FREE");
    } finally {
        restoreEnv();
        if (organization) await cleanupPhoneVerification({ organizationIds: [organization.id], userIds: [owner.id] });
    }
});

// ==================================================================
// WA-E / WA-O — choke point 1 (caso B: selección explícita) + consumo del
// pending selection.
// ==================================================================

testWithDb("WA-E: elegir entre Organization A (FREE) y B (PREMIUM) del mismo owner usa el plan de la elegida, por organizationId real", async () => {
    const owner = await createUser();
    const orgFree = await createOrganization(owner.id, { plan: "FREE" });
    const orgPremium = await createOrganization(owner.id, { plan: "PREMIUM" });
    const channelRef = uniqueWaId();
    const { sendText, calls } = fakeSender();
    try {
        // Elegir la FREE (índice 1) -> bloqueada.
        await prisma.whatsappPendingOrganizationSelection.create({
            data: { waId: channelRef, status: "AWAITING_SELECTION", candidateOrganizationIds: [orgFree.id, orgPremium.id] },
        });
        await processInboundMessage(textMessage({ from: channelRef, text: "1" }), { sendText });
        assert.equal(calls.at(-1).text, WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT);
        const convAfterFree = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef } });
        assert.equal(convAfterFree, null, "elegir la FREE no debe crear ninguna ConversationState");

        // Elegir la PREMIUM (nueva selección igual a la anterior, índice 2) -> permitida.
        await prisma.whatsappPendingOrganizationSelection.create({
            data: { waId: channelRef, status: "AWAITING_SELECTION", candidateOrganizationIds: [orgFree.id, orgPremium.id] },
        });
        await processInboundMessage(textMessage({ from: channelRef, text: "2" }), { sendText });
        const convAfterPremium = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef, status: "ACTIVE" } });
        assert.ok(convAfterPremium, "elegir la PREMIUM debe crear la ConversationState");
        assert.equal(convAfterPremium.organizationId, orgPremium.id, "debe ser exactamente la Organization elegida por índice, nunca la otra");
    } finally {
        await cleanup({ organizationIds: [orgFree.id, orgPremium.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

testWithDb("WA-O: seleccionar válidamente una Organization FREE consume el pending selection (decisión de producto aprobada)", async () => {
    const owner = await createUser();
    const orgFree = await createOrganization(owner.id, { plan: "FREE" });
    const channelRef = uniqueWaId();
    const { sendText } = fakeSender();
    try {
        await prisma.whatsappPendingOrganizationSelection.create({
            data: { waId: channelRef, status: "AWAITING_SELECTION", candidateOrganizationIds: [orgFree.id] },
        });
        await processInboundMessage(textMessage({ from: channelRef, text: "1" }), { sendText });

        const pending = await prisma.whatsappPendingOrganizationSelection.findUnique({ where: { waId: channelRef } });
        assert.equal(pending, null, "la selección válida se consume aunque el feature gate la bloquee después");
        const conv = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef } });
        assert.equal(conv, null);
    } finally {
        await cleanup({ organizationIds: [orgFree.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

// ==================================================================
// WA-F / WA-G / WA-H / WA-I / WA-K / WA-L — choke point 2 (conversación
// activa): avanza en PREMIUM, se bloquea sin tocar nada en el downgrade a
// FREE, y retoma exactamente donde estaba al volver a PREMIUM. Un solo
// escenario causal encadenado (mismo criterio que otros archivos de este
// repo, ej. eventAdmissionType.test.js#H).
// ==================================================================

testWithDb("WA-F/G/H/I/K/L: conversación activa avanza en PREMIUM, se bloquea intacta en FREE, y retoma al volver a PREMIUM", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const channelRef = uniqueWaId();
    const conv = await prisma.conversationState.create({
        data: {
            channel: "WHATSAPP",
            channelRef,
            organizationId: org.id,
            userId: owner.clerkId,
            currentStepId: "NAME",
            draftEvent: {},
            history: ["NAME"],
            status: "ACTIVE",
        },
    });
    const { sendText, calls } = fakeSender();
    try {
        // WA-F: PREMIUM con conversación activa avanza con normalidad.
        await processInboundMessage(textMessage({ from: channelRef, text: "Fiesta de Prueba" }), { sendText });
        let fresh = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(fresh.currentStepId, "DESCRIPTION", "PREMIUM debe poder avanzar normalmente");
        assert.equal(fresh.draftEvent.title, "Fiesta de Prueba");

        // Downgrade a mitad de conversación.
        await prisma.organization.update({ where: { id: org.id }, data: { plan: "FREE" } });

        // WA-G: el siguiente mensaje queda bloqueado.
        await processInboundMessage(textMessage({ from: channelRef, text: "Una descripción cualquiera" }), { sendText });
        assert.equal(calls.at(-1).text, WHATSAPP_EVENT_CREATION_PREMIUM_REQUIRED_TEXT);

        // WA-H / WA-K: nada se modificó — ni el step, ni el draft, ni se creó ningún Event.
        fresh = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(fresh.status, "ACTIVE", "la conversación sigue ACTIVE, nunca se borra por el downgrade");
        assert.equal(fresh.currentStepId, "DESCRIPTION", "el step no debe haber avanzado");
        assert.equal(fresh.draftEvent.title, "Fiesta de Prueba", "el draft no debe haber cambiado");
        assert.equal(fresh.draftEvent.description, undefined, "el mensaje bloqueado no debe haberse escrito en el draft");
        const eventCount = await prisma.event.count({ where: { organizationId: org.id } });
        assert.equal(eventCount, 0, "un mensaje bloqueado nunca debe crear ni modificar ningún Event");

        // Upgrade de vuelta a PREMIUM.
        await prisma.organization.update({ where: { id: org.id }, data: { plan: "PREMIUM" } });

        // WA-I / WA-L: el siguiente mensaje retoma exactamente donde estaba,
        // con una lectura fresca del plan (nunca un valor cacheado).
        await processInboundMessage(textMessage({ from: channelRef, text: "Una descripción real" }), { sendText });
        fresh = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(fresh.currentStepId, "CATEGORY", "debe avanzar un paso más desde DESCRIPTION, retomando el estado previo");
        assert.equal(fresh.draftEvent.description, "Una descripción real");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

// ==================================================================
// WA-J — CANCEL siempre funciona, incluso con Organization FREE.
// ==================================================================

testWithDb("WA-J: CANCEL funciona normalmente con Organization FREE y conversación activa", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const channelRef = uniqueWaId();
    const conv = await prisma.conversationState.create({
        data: {
            channel: "WHATSAPP",
            channelRef,
            organizationId: org.id,
            userId: owner.clerkId,
            currentStepId: "NAME",
            draftEvent: {},
            history: ["NAME"],
            status: "ACTIVE",
        },
    });
    const { sendText, calls } = fakeSender();
    try {
        await processInboundMessage(textMessage({ from: channelRef, text: "cancelar" }), { sendText });

        assert.equal(calls.at(-1).text, WHATSAPP_CANCEL_TEXT);
        const fresh = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(fresh, null, "CANCEL borra la ConversationState — mismo comportamiento real existente, sin importar el plan");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id], channelRefs: [channelRef] });
    }
});

// ==================================================================
// WA-M — el gate de WhatsApp (Fase 2C) nunca duplica ni reemplaza
// maxActiveEvents (Fase 2B): se ejercita EventCreationEngine directo (sin
// pasar por whatsapp.controller.js, donde vive el gate de Fase 2C) para
// demostrar que el límite sigue aplicando exactamente igual.
// ==================================================================

testWithDb("WA-M: PREMIUM con maxActiveEvents alcanzado sigue bloqueado por Fase 2B al publicar, sin duplicar el guard de WhatsApp", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let existingEvent;
    let conv;
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxActiveEvents: 1 });

        existingEvent = await createEventService(owner.clerkId, { title: "Ya publicado", admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
        await syncEventScheduleService(
            owner.clerkId,
            existingEvent.id,
            { functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }], ticketTypes: [] },
            org.id
        );
        await updateMyEventService(owner.clerkId, existingEvent.id, { status: "PUBLISHED" }, org.id); // 1/1 activo

        conv = await prisma.conversationState.create({
            data: {
                channel: "WHATSAPP",
                channelRef: uniqueWaId(),
                organizationId: org.id,
                userId: owner.clerkId,
                currentStepId: "PREVIEW",
                history: ["NAME", "PREVIEW"],
                status: "ACTIVE",
                draftEvent: {
                    title: "Otro evento",
                    description: "desc",
                    category: "MUSICA",
                    admissionType: "FREE_ENTRY",
                    location: draftLocationInput(),
                    functions: [{ date: "2099-09-01", startTime: "20:00", endTime: "23:00" }],
                    hasTickets: false,
                    ticketTypes: [],
                },
            },
        });

        const result = await EventCreationEngine.handleInput(conv.id, { action: "PUBLISH" });

        assert.equal(result.done, undefined, "no debe haberse completado la publicación");
        assert.equal(
            result.prompt.error,
            "Alcanzaste el máximo de eventos activos de tu plan.",
            "debe ser el mismo mensaje real de Fase 2B, nunca un duplicado del gate de WhatsApp"
        );

        const activeCount = await prisma.event.count({ where: { organizationId: org.id, status: "PUBLISHED", archivedAt: null } });
        assert.equal(activeCount, 1, "el límite de Fase 2B se mantuvo — nunca se publicó el segundo evento");
    } finally {
        await restorePlanLimits(snapshot);
        if (conv) await prisma.conversationState.deleteMany({ where: { id: conv.id } });
        await cleanupEvents({ organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// ==================================================================
// WA-N — dos Organizations del mismo owner: bloquear una no contamina a la
// otra (conversaciones/canales independientes).
// ==================================================================

testWithDb("WA-N: la Organization A (FREE) no contamina a la Organization B (PREMIUM) del mismo owner", async () => {
    const owner = await createUser();
    const orgFree = await createOrganization(owner.id, { plan: "FREE" });
    const orgPremium = await createOrganization(owner.id, { plan: "PREMIUM" });
    const channelRefFree = uniqueWaId();
    const channelRefPremium = uniqueWaId();
    await prisma.whatsappOrganizerLink.create({ data: { waId: channelRefFree, organizationId: orgFree.id } });
    await prisma.whatsappOrganizerLink.create({ data: { waId: channelRefPremium, organizationId: orgPremium.id } });
    const { sendText } = fakeSender();
    try {
        await processInboundMessage(textMessage({ from: channelRefFree, text: "1" }), { sendText });
        const convFree = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef: channelRefFree } });
        assert.equal(convFree, null, "orgFree queda bloqueada, sin conversación");

        await processInboundMessage(textMessage({ from: channelRefPremium, text: "1" }), { sendText });
        const convPremium = await prisma.conversationState.findFirst({ where: { channel: "WHATSAPP", channelRef: channelRefPremium, status: "ACTIVE" } });
        assert.ok(convPremium, "orgPremium debe poder iniciar su propia conversación, sin verse afectada por orgFree");
        assert.equal(convPremium.organizationId, orgPremium.id);
    } finally {
        await cleanup({
            organizationIds: [orgFree.id, orgPremium.id],
            userIds: [owner.id],
            channelRefs: [channelRefFree, channelRefPremium],
        });
    }
});
