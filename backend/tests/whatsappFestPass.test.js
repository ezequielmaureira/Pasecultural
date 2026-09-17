import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import * as EventCreationEngine from "../src/conversation/EventCreationEngine.js";
import * as EventServicePort from "../src/conversation/EventServicePort.js";
import { buildWhatsappPublicEventUrl, buildWhatsappEventSummaryText } from "../src/services/whatsappOrganizerBot.service.js";

// Fest Pass por WhatsApp — motor real (EventCreationEngine.handleInput),
// mismo idioma que eventCreationEngine.admissionType.test.js: siembra el
// ConversationState directo en el step que interesa (Prisma real, DB de
// test), sin caminar todas las preguntas previas.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

async function createConversationState(overrides = {}) {
    const suffix = randomUUID().slice(0, 8);
    return prisma.conversationState.create({
        data: {
            channel: "WHATSAPP",
            channelRef: `5491100${suffix}`,
            currentStepId: "NAME",
            draftEvent: {},
            history: ["NAME"],
            status: "ACTIVE",
            ...overrides,
        },
    });
}

async function deleteConversationState(id) {
    await prisma.conversationState.deleteMany({ where: { id } });
}

// ==================================================================
// A) ENGINE / TIPO DE EVENTO
// ==================================================================

testWithDb("A1) start() sin initialStepId sigue arrancando en NAME (Web, sin cambios)", async () => {
    const state = await EventCreationEngine.start({ clerkId: "user_1", channel: "WEB", channelRef: "web-session-1" });
    try {
        assert.equal(state.prompt.stepId, "NAME");
    } finally {
        await deleteConversationState(state.conversationId);
    }
});

testWithDb("A2) start({ initialStepId: EVENT_CREATION_TYPE }) arranca ahí (WhatsApp)", async () => {
    const state = await EventCreationEngine.start({ clerkId: "user_1", channel: "WHATSAPP", channelRef: "5491100000001", initialStepId: "EVENT_CREATION_TYPE" });
    try {
        assert.equal(state.prompt.stepId, "EVENT_CREATION_TYPE");
        assert.deepEqual(
            state.prompt.options.map((o) => o.id),
            ["FEST_PASS", "TRADITIONAL"]
        );
    } finally {
        await deleteConversationState(state.conversationId);
    }
});

testWithDb("A3) start() con un initialStepId inexistente nunca crea un ConversationState roto", async () => {
    await assert.rejects(() => EventCreationEngine.start({ clerkId: "user_1", channel: "WHATSAPP", channelRef: "5491100000002", initialStepId: "NOT_A_REAL_STEP" }));
    const orphan = await prisma.conversationState.findFirst({ where: { channelRef: "5491100000002" } });
    assert.equal(orphan, null, "no debe haber quedado ninguna fila persistida");
});

testWithDb("A4) FEST_PASS -> NAME, y configura quickPassEnabled/admissionType/hasTickets/pricingType", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_CREATION_TYPE", history: ["EVENT_CREATION_TYPE"] });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "FEST_PASS" });
        assert.equal(result.prompt.stepId, "NAME");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassEnabled, true);
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");
        assert.equal(persisted.draftEvent.hasTickets, true);
        assert.equal(persisted.draftEvent.pricingType, "PAID");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A5) TRADITIONAL -> NAME, y deja quickPassEnabled=false", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_CREATION_TYPE", history: ["EVENT_CREATION_TYPE"] });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "TRADITIONAL" });
        assert.equal(result.prompt.stepId, "NAME");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassEnabled, false);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A6) BACK desde NAME (arrancado en EVENT_CREATION_TYPE) vuelve a EVENT_CREATION_TYPE", async () => {
    const conv = await createConversationState({
        currentStepId: "NAME",
        draftEvent: { quickPassEnabled: false, _creationType: "TRADITIONAL" },
        history: ["EVENT_CREATION_TYPE", "NAME"],
    });
    try {
        const back = await EventCreationEngine.handleInput(conv.id, { action: "BACK" });
        assert.equal(back.prompt.stepId, "EVENT_CREATION_TYPE");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A7) BACK desde EVENT_CREATION_TYPE (primera pregunta real) usa el comportamiento estándar", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_CREATION_TYPE", history: ["EVENT_CREATION_TYPE"] });
    try {
        const back = await EventCreationEngine.handleInput(conv.id, { action: "BACK" });
        assert.equal(back.prompt.error, "Ya estás en la primera pregunta.");
        assert.equal(back.canGoBack, false);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// B) FOTO PRINCIPAL
// ==================================================================

testWithDb("B1) Fest Pass COVER_IMAGE: coverImage y quickPassImageUrl quedan con la MISMA URL", async () => {
    const conv = await createConversationState({
        currentStepId: "COVER_IMAGE",
        draftEvent: { quickPassEnabled: true },
        history: ["EVENT_CREATION_TYPE", "NAME", "DESCRIPTION", "CATEGORY", "COVER_IMAGE"],
    });
    try {
        const url = "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/fest.jpg";
        await EventCreationEngine.handleInput(conv.id, { value: url });

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.coverImage, url);
        assert.equal(persisted.draftEvent.quickPassImageUrl, url);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("B2) Traditional COVER_IMAGE: sólo coverImage, nunca quickPassImageUrl", async () => {
    const conv = await createConversationState({
        currentStepId: "COVER_IMAGE",
        draftEvent: { quickPassEnabled: false },
        history: ["EVENT_CREATION_TYPE", "NAME", "DESCRIPTION", "CATEGORY", "COVER_IMAGE"],
    });
    try {
        const url = "https://res.cloudinary.com/pasecultural/image/upload/v1/pasecultural/evento.jpg";
        await EventCreationEngine.handleInput(conv.id, { value: url });

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.coverImage, url);
        assert.equal(persisted.draftEvent.quickPassImageUrl, undefined);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// C) PRICING
// ==================================================================

testWithDb("C1) Fest Pass TICKET_PRICE = 0 es rechazado con un error claro", async () => {
    const conv = await createConversationState({
        currentStepId: "TICKET_PRICE",
        draftEvent: { quickPassEnabled: true, _ticketDraft: { name: "General" } },
        history: ["EVENT_CREATION_TYPE", "TICKET_NAME", "TICKET_PRICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: 0 });
        assert.equal(result.prompt.error, "El Fest Pass necesita un precio mayor a 0.");
        assert.equal(result.prompt.stepId, "TICKET_PRICE", "no avanza de step");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("C2) Fest Pass TICKET_PRICE > 0 se acepta normalmente", async () => {
    const conv = await createConversationState({
        currentStepId: "TICKET_PRICE",
        draftEvent: { quickPassEnabled: true, _ticketDraft: { name: "General" } },
        history: ["EVENT_CREATION_TYPE", "TICKET_NAME", "TICKET_PRICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: 5000 });
        assert.equal(result.prompt.error, undefined);
        assert.equal(result.prompt.stepId, "TICKET_QUANTITY");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("C3) Traditional TICKET_PRICE = 0 sigue aceptándose exactamente como hoy", async () => {
    const conv = await createConversationState({
        currentStepId: "TICKET_PRICE",
        draftEvent: { quickPassEnabled: false, _ticketDraft: { name: "General" } },
        history: ["EVENT_PRICING_TYPE", "TICKET_NAME", "TICKET_PRICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: 0 });
        assert.equal(result.prompt.error, undefined);
        assert.equal(result.prompt.stepId, "TICKET_QUANTITY");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// D) DESPUÉS DE LAS FUNCIONES (FUNCTIONS_LIST#next)
// ==================================================================

testWithDb("D1) Fest Pass: FUNCTIONS_LIST confirmado salta directo a TICKET_NAME (nunca EVENT_PRICING_TYPE)", async () => {
    const conv = await createConversationState({
        currentStepId: "FUNCTIONS_LIST",
        draftEvent: { quickPassEnabled: true },
        history: ["EVENT_CREATION_TYPE", "LOCATION", "FUNCTIONS_MODE", "FUNCTIONS_LIST"],
    });
    try {
        const slots = [{ date: "2026-12-01", startTime: "20:00", endTime: "22:00" }];
        const result = await EventCreationEngine.handleInput(conv.id, { value: slots });
        assert.equal(result.prompt.stepId, "TICKET_NAME");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("D2) Traditional: FUNCTIONS_LIST confirmado sigue yendo a EVENT_PRICING_TYPE", async () => {
    const conv = await createConversationState({
        currentStepId: "FUNCTIONS_LIST",
        draftEvent: { quickPassEnabled: false },
        history: ["LOCATION", "FUNCTIONS_MODE", "FUNCTIONS_LIST"],
    });
    try {
        const slots = [{ date: "2026-12-01", startTime: "20:00", endTime: "22:00" }];
        const result = await EventCreationEngine.handleInput(conv.id, { value: slots });
        assert.equal(result.prompt.stepId, "EVENT_PRICING_TYPE");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// G) ELECCIÓN DE VIDEO (ADD_ANOTHER_TICKET#next + FEST_PASS_VIDEO_CHOICE)
// ==================================================================

testWithDb("G1) Fest Pass: terminar de cargar entradas (CONTINUE) lleva a FEST_PASS_VIDEO_CHOICE, no a PROMO_VIDEO_ASK", async () => {
    const conv = await createConversationState({
        currentStepId: "ADD_ANOTHER_TICKET",
        draftEvent: { quickPassEnabled: true, ticketTypes: [{ name: "General", price: 5000, quantity: 100 }] },
        history: ["TICKET_NAME", "TICKET_PRICE", "TICKET_QUANTITY", "ADD_ANOTHER_TICKET"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "CONTINUE" });
        assert.equal(result.prompt.stepId, "FEST_PASS_VIDEO_CHOICE");
        assert.deepEqual(
            result.prompt.options.map((o) => o.id),
            ["UPLOAD", "YOUTUBE", "SKIP"]
        );
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G2) Traditional: terminar de cargar entradas (CONTINUE) sigue yendo a PROMO_VIDEO_ASK", async () => {
    const conv = await createConversationState({
        currentStepId: "ADD_ANOTHER_TICKET",
        draftEvent: { quickPassEnabled: false, ticketTypes: [{ name: "General", price: 0, quantity: 100 }] },
        history: ["TICKET_NAME", "TICKET_PRICE", "TICKET_QUANTITY", "ADD_ANOTHER_TICKET"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "CONTINUE" });
        assert.equal(result.prompt.stepId, "PROMO_VIDEO_ASK");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G3) ADD_ANOTHER_TICKET con value=ADD sigue yendo a TICKET_NAME (Fest Pass y Traditional por igual, sin cambios)", async () => {
    const conv = await createConversationState({
        currentStepId: "ADD_ANOTHER_TICKET",
        draftEvent: { quickPassEnabled: true, ticketTypes: [{ name: "General", price: 5000, quantity: 100 }] },
        history: ["TICKET_NAME", "TICKET_PRICE", "TICKET_QUANTITY", "ADD_ANOTHER_TICKET"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "ADD" });
        assert.equal(result.prompt.stepId, "TICKET_NAME");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G4) FEST_PASS_VIDEO_CHOICE: UPLOAD -> FEST_PASS_VIDEO_UPLOAD", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: { quickPassEnabled: true },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "UPLOAD" });
        assert.equal(result.prompt.stepId, "FEST_PASS_VIDEO_UPLOAD");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G5) FEST_PASS_VIDEO_CHOICE: YOUTUBE -> PROMO_VIDEO_URL", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: { quickPassEnabled: true },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "YOUTUBE" });
        assert.equal(result.prompt.stepId, "PROMO_VIDEO_URL");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G6) FEST_PASS_VIDEO_CHOICE: SKIP -> SOCIAL_LINKS_ASK", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: { quickPassEnabled: true },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "SKIP" });
        assert.equal(result.prompt.stepId, "SOCIAL_LINKS_ASK");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G7) YOUTUBE en Fest Pass guarda SÓLO promoVideoUrl, nunca quickPassVideoUrl/PublicId", async () => {
    const conv = await createConversationState({
        currentStepId: "PROMO_VIDEO_URL",
        draftEvent: { quickPassEnabled: true },
        history: ["FEST_PASS_VIDEO_CHOICE", "PROMO_VIDEO_URL"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.promoVideoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        assert.equal(persisted.draftEvent.quickPassVideoUrl, undefined);
        assert.equal(persisted.draftEvent.quickPassVideoPublicId, undefined);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G8) FEST_PASS_VIDEO_UPLOAD guarda quickPassVideoUrl/PublicId a partir de {url, publicId} y avanza a SOCIAL_LINKS_ASK", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_UPLOAD",
        draftEvent: { quickPassEnabled: true, quickPassImageUrl: "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg" },
        history: ["FEST_PASS_VIDEO_CHOICE", "FEST_PASS_VIDEO_UPLOAD"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, {
            value: { url: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4", publicId: "pasecultural/fest" },
        });
        assert.equal(result.prompt.stepId, "SOCIAL_LINKS_ASK");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassVideoUrl, "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4");
        assert.equal(persisted.draftEvent.quickPassVideoPublicId, "pasecultural/fest");
        // La imagen sigue existiendo — el video nunca la reemplaza.
        assert.equal(persisted.draftEvent.quickPassImageUrl, "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg");
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G9) FEST_PASS_VIDEO_UPLOAD rechaza cualquier valor que no sea {url, publicId} válido", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_UPLOAD",
        draftEvent: { quickPassEnabled: true },
        history: ["FEST_PASS_VIDEO_CHOICE", "FEST_PASS_VIDEO_UPLOAD"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "un mensaje de texto cualquiera" });
        assert.equal(result.prompt.error, "Mandame un video para continuar.");
        assert.equal(result.prompt.stepId, "FEST_PASS_VIDEO_UPLOAD");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// G-bis) HARDENING — FEST_PASS_VIDEO_CHOICE nunca deja datos de la rama
// NO elegida esta vez (BACK no revierte draftEvent, ver comentario en
// definitions.js#FEST_PASS_VIDEO_CHOICE).
// ==================================================================

testWithDb("G10) upload previo + volver + SKIP deja quickPassVideoUrl/PublicId vacíos", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: {
            quickPassEnabled: true,
            quickPassVideoUrl: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4",
            quickPassVideoPublicId: "pasecultural/fest",
        },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "SKIP" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassVideoUrl, null);
        assert.equal(persisted.draftEvent.quickPassVideoPublicId, null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G11) YouTube previo + volver + SKIP deja promoVideoUrl vacío", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: { quickPassEnabled: true, promoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", wantsPromoVideo: true },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "SKIP" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.promoVideoUrl, null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G12) upload previo + volver + YOUTUBE deja quickPassVideoUrl/PublicId vacíos", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: {
            quickPassEnabled: true,
            quickPassVideoUrl: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4",
            quickPassVideoPublicId: "pasecultural/fest",
        },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "YOUTUBE" });
        assert.equal(result.prompt.stepId, "PROMO_VIDEO_URL");
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassVideoUrl, null);
        assert.equal(persisted.draftEvent.quickPassVideoPublicId, null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("G13) YouTube previo + volver + UPLOAD deja promoVideoUrl vacío", async () => {
    const conv = await createConversationState({
        currentStepId: "FEST_PASS_VIDEO_CHOICE",
        draftEvent: { quickPassEnabled: true, promoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", wantsPromoVideo: true },
        history: ["ADD_ANOTHER_TICKET", "FEST_PASS_VIDEO_CHOICE"],
    });
    try {
        const result = await EventCreationEngine.handleInput(conv.id, { value: "UPLOAD" });
        assert.equal(result.prompt.stepId, "FEST_PASS_VIDEO_UPLOAD");
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.promoVideoUrl, null);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// A-bis) HARDENING — EVENT_CREATION_TYPE nunca arrastra campos
// incompatibles al cambiar realmente de tipo (BACK no revierte draftEvent).
// ==================================================================

testWithDb("A8) FEST_PASS -> volver -> TRADITIONAL elimina los campos quickPass", async () => {
    const conv = await createConversationState({
        currentStepId: "EVENT_CREATION_TYPE",
        draftEvent: {
            _creationType: "FEST_PASS",
            quickPassEnabled: true,
            quickPassImageUrl: "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg",
            quickPassVideoUrl: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4",
            quickPassVideoPublicId: "pasecultural/fest",
            admissionType: "TICKETED",
            hasTickets: true,
            pricingType: "PAID",
            ticketTypes: [{ name: "General", price: 5000, quantity: 100 }],
        },
        history: ["EVENT_CREATION_TYPE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "TRADITIONAL" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassEnabled, false);
        assert.equal(persisted.draftEvent.quickPassImageUrl, null);
        assert.equal(persisted.draftEvent.quickPassVideoUrl, null);
        assert.equal(persisted.draftEvent.quickPassVideoPublicId, null);
        assert.equal(persisted.draftEvent.pricingType, undefined);
        assert.equal(persisted.draftEvent.admissionType, undefined);
        assert.equal(persisted.draftEvent.hasTickets, undefined);
        assert.deepEqual(persisted.draftEvent.ticketTypes, []);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A9) TRADITIONAL con entrada a $0 -> volver -> FEST_PASS limpia esos ticketTypes", async () => {
    const conv = await createConversationState({
        currentStepId: "EVENT_CREATION_TYPE",
        draftEvent: {
            _creationType: "TRADITIONAL",
            quickPassEnabled: false,
            ticketTypes: [{ name: "General", price: 0, quantity: 100 }],
            _ticketDraft: { name: "General", price: 0, quantity: 100 },
        },
        history: ["EVENT_CREATION_TYPE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "FEST_PASS" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassEnabled, true);
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");
        assert.equal(persisted.draftEvent.pricingType, "PAID");
        assert.deepEqual(persisted.draftEvent.ticketTypes, []);
        assert.deepEqual(persisted.draftEvent._ticketDraft, {});
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A10) re-seleccionar FEST_PASS cuando ya era FEST_PASS no borra información compatible", async () => {
    const conv = await createConversationState({
        currentStepId: "EVENT_CREATION_TYPE",
        draftEvent: {
            _creationType: "FEST_PASS",
            quickPassEnabled: true,
            quickPassImageUrl: "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg",
            admissionType: "TICKETED",
            hasTickets: true,
            pricingType: "PAID",
            ticketTypes: [{ name: "General", price: 5000, quantity: 100 }],
        },
        history: ["EVENT_CREATION_TYPE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "FEST_PASS" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassImageUrl, "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg");
        assert.deepEqual(persisted.draftEvent.ticketTypes, [{ name: "General", price: 5000, quantity: 100 }]);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("A11) re-seleccionar TRADITIONAL cuando ya era TRADITIONAL no rompe el draft", async () => {
    const conv = await createConversationState({
        currentStepId: "EVENT_CREATION_TYPE",
        draftEvent: {
            _creationType: "TRADITIONAL",
            quickPassEnabled: false,
            title: "Ya cargado antes de volver",
            ticketTypes: [{ name: "General", price: 0, quantity: 50 }],
        },
        history: ["EVENT_CREATION_TYPE"],
    });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "TRADITIONAL" });
        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.quickPassEnabled, false);
        assert.equal(persisted.draftEvent.title, "Ya cargado antes de volver");
        assert.deepEqual(persisted.draftEvent.ticketTypes, [{ name: "General", price: 0, quantity: 50 }]);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// H) PERSISTENCIA (EventServicePort.commit -> createEventService real)
// ==================================================================

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser() {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER" },
    });
}

async function createOrganization(ownerId) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Sala ${suffix}`, email: `org_${suffix}@example.com`, status: "APPROVED", ownerId },
    });
}

async function cleanupEvent({ eventId, organizationId, userId }) {
    if (eventId) {
        await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId } } });
        await prisma.ticketType.deleteMany({ where: { eventId } });
        await prisma.eventFunction.deleteMany({ where: { eventId } });
        await prisma.event.deleteMany({ where: { id: eventId } });
    }
    if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
}

function festPassDraft(overrides = {}) {
    return {
        title: "Mi Fest Pass",
        admissionType: "TICKETED",
        hasTickets: true,
        pricingType: "PAID",
        quickPassEnabled: true,
        quickPassImageUrl: "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg",
        location: { venueName: "Plaza Central", address: "Calle Falsa 123", latitude: -33.12, longitude: -64.34 },
        functions: [{ date: "2099-08-25", startTime: "20:00", endTime: "23:00" }],
        ticketTypes: [{ name: "General", price: 5000, quantity: 100 }],
        ...overrides,
    };
}

testWithDb("H1) commit(DRAFT) de un draft Fest Pass persiste quickPassEnabled/quickPassImageUrl reales", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await EventServicePort.commit(owner.clerkId, festPassDraft(), "DRAFT", org.id);

        assert.equal(event.status, "DRAFT");
        assert.equal(event.quickPassEnabled, true);
        assert.equal(event.quickPassImageUrl, "https://res.cloudinary.com/pasecultural/image/upload/v1/fest.jpg");
        assert.equal(event.admissionType, "TICKETED");
    } finally {
        await cleanupEvent({ eventId: event?.id, organizationId: org.id, userId: owner.id });
    }
});

testWithDb("H2) commit(PUBLISH) de un Fest Pass válido (con entrada paga real) publica correctamente y persiste el video de fondo cuando existe", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        event = await EventServicePort.commit(
            owner.clerkId,
            festPassDraft({ quickPassVideoUrl: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4", quickPassVideoPublicId: "pasecultural/fest" }),
            "PUBLISH",
            org.id
        );

        assert.equal(event.status, "PUBLISHED");
        assert.equal(event.quickPassEnabled, true);
        assert.equal(event.quickPassVideoUrl, "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4");
        assert.equal(event.quickPassVideoPublicId, "pasecultural/fest");
    } finally {
        await cleanupEvent({ eventId: event?.id, organizationId: org.id, userId: owner.id });
    }
});

testWithDb("H3) commit() de un evento tradicional NUNCA activa Quick/Fest Pass por accidente", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    let event;
    try {
        const traditionalDraft = {
            title: "Evento tradicional",
            admissionType: "TICKETED",
            hasTickets: true,
            location: { venueName: "Plaza Central", address: "Calle Falsa 123", latitude: -33.12, longitude: -64.34 },
            functions: [{ date: "2099-08-25", startTime: "20:00", endTime: "23:00" }],
            ticketTypes: [{ name: "General", price: 0, quantity: 100 }],
        };
        event = await EventServicePort.commit(owner.clerkId, traditionalDraft, "DRAFT", org.id);

        assert.equal(event.quickPassEnabled, false);
        assert.equal(event.quickPassImageUrl, null);
        assert.equal(event.quickPassVideoUrl, null);
    } finally {
        await cleanupEvent({ eventId: event?.id, organizationId: org.id, userId: owner.id });
    }
});

// ==================================================================
// I) URL FINAL
// ==================================================================

test("I1) publicación tradicional genera /evento/:slug", () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://pasecultural.com";
    try {
        const url = buildWhatsappPublicEventUrl({ slug: "mi-evento", quickPassEnabled: false });
        assert.ok(url.endsWith("/evento/mi-evento"));
        assert.ok(!url.includes("/fest-pass/"));
    } finally {
        if (original === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = original;
    }
});

test("I2) publicación Fest Pass genera /fest-pass/:slug", () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://pasecultural.com";
    try {
        const url = buildWhatsappPublicEventUrl({ slug: "mi-fest-pass", quickPassEnabled: true });
        assert.ok(url.endsWith("/fest-pass/mi-fest-pass"));
        assert.ok(!url.includes("/evento/"));
    } finally {
        if (original === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = original;
    }
});

// ==================================================================
// J) PREVIEW
// ==================================================================

test("J1) Fest Pass: el resumen muestra el tipo y si tiene video de fondo, y mantiene YouTube separado", () => {
    const summaryWithVideo = buildWhatsappEventSummaryText({
        title: "Mi Fest",
        quickPassEnabled: true,
        quickPassVideoUrl: "https://res.cloudinary.com/pasecultural/video/upload/v1/fest.mp4",
        promoVideoUrl: "https://youtube.com/watch?v=abc",
        ticketTypes: [{ name: "General", price: 5000, quantity: 100 }],
        functions: [],
    });
    assert.ok(summaryWithVideo.includes("⚡ Tipo: Fest Pass"));
    assert.ok(summaryWithVideo.includes("🎥 Video de fondo: Sí"));
    assert.ok(summaryWithVideo.includes("🎬 YouTube: Sí"));

    const summaryNoVideo = buildWhatsappEventSummaryText({ title: "Mi Fest", quickPassEnabled: true, ticketTypes: [], functions: [] });
    assert.ok(summaryNoVideo.includes("🎥 Video de fondo: No"));
});

test("J2) Traditional: el resumen nunca muestra la línea de Fest Pass", () => {
    const summary = buildWhatsappEventSummaryText({ title: "Mi Evento", quickPassEnabled: false, ticketTypes: [], functions: [] });
    assert.ok(!summary.includes("Fest Pass"));
    assert.ok(!summary.includes("Video de fondo"));
});
