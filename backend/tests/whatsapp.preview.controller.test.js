import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    extractWhatsappReplyText,
    buildWhatsappEventSummaryText,
    buildWhatsappPreviewMenuText,
    resolveWhatsappPreviewChoice,
    buildWhatsappPublicEventUrl,
    WHATSAPP_PREVIEW_INVALID_TEXT,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3G, secciones 6/7 — resumen real del evento en PREVIEW + menú
// numerado PUBLICAR/BORRADOR/VOLVER, en reemplazo del texto genérico
// ("terminá de revisarlo desde la web") y del bug reportado ("Ok"/"Publish"
// rechazados con "Elegí PUBLISH, DRAFT o EDIT"). tryHandlePreviewSubflow
// nunca deja pasar texto crudo al motor: siempre envía una acción real
// (PUBLISH/DRAFT/BACK).

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "hola",
        image: null,
        location: null,
        profileName: "Elvis Bar",
        phoneNumberId: "PHONE_ID_1",
        ...overrides,
    };
}

function fakeSender(result = { success: true, messageId: "wamid.OUT1", error: null }) {
    const calls = [];
    const sendText = async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
    };
    return { sendText, calls };
}

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

const FULL_DRAFT = {
    title: "Fiesta Aniversario",
    description: "Una noche especial",
    coverImage: "https://res.cloudinary.com/x/image/upload/cover.jpg",
    location: { venueName: "Club Social", address: "San Martín 850", city: "Río Cuarto", province: "Córdoba", latitude: -33.12, longitude: -64.34, googlePlaceId: null },
    functions: [
        { date: "2099-08-25", startTime: "20:00", endTime: "23:00" },
        { date: "2099-09-01", startTime: "21:00", endTime: "23:30" },
    ],
    hasTickets: true,
    pricingType: "PAID",
    ticketTypes: [
        { name: "General", price: 20000, quantity: 100 },
        { name: "VIP", price: 45000, quantity: 20 },
    ],
    wantsPromoVideo: true,
    promoVideoUrl: "https://youtu.be/abc123",
    wantsSocialLinks: true,
    socialLinks: [{ network: "INSTAGRAM", url: "https://instagram.com/x" }],
};

const MINIMAL_DRAFT = {
    title: "Show gratuito",
    description: "Entrada libre",
    coverImage: null,
    location: { address: "Colón 100", city: "Córdoba", province: "Córdoba" },
    functions: [{ date: "2099-08-25", startTime: "20:00", endTime: "22:00" }],
    hasTickets: false,
    pricingType: "FREE",
    ticketTypes: [],
    wantsPromoVideo: false,
    promoVideoUrl: null,
    wantsSocialLinks: false,
    socialLinks: [],
};

function previewState(draft, error) {
    return {
        conversationId: "conv1",
        prompt: { stepId: "PREVIEW", type: "PREVIEW", draft, ...(error ? { error } : {}) },
        canGoBack: true,
        sections: [],
    };
}

function baseDeps({ resumeConversation, handleConversationInput, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: resumeConversation ?? spy(previewState(MINIMAL_DRAFT)),
            handleConversationInput: handleConversationInput ?? spy(previewState(MINIMAL_DRAFT)),
            cancelConversation: spy(undefined),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(null),
            updatePendingStepInputStatus: spy(null),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================
// E. Resumen — construido a partir del draft REAL, nunca JSON/raw.
// ==================================================

test("E. the summary uses real draft data: title, description, image, location+maps link", () => {
    const text = buildWhatsappEventSummaryText(FULL_DRAFT);
    assert.ok(text.includes("🎭 Nombre: Fiesta Aniversario"));
    assert.ok(text.includes("📝 Descripción: Una noche especial"));
    assert.ok(text.includes("🖼️ Imagen: Cargada"));
    assert.ok(text.includes("Club Social"));
    assert.ok(text.includes("San Martín 850"));
    assert.ok(text.includes("🗺️ https://www.google.com/maps/search/?api=1&query=-33.12,-64.34"));
});

test("E. the summary lists functions correctly, in order, DD/MM/AAAA", () => {
    const text = buildWhatsappEventSummaryText(FULL_DRAFT);
    assert.ok(text.includes("• 25/08/2099 · 20:00 a 23:00"));
    assert.ok(text.includes("• 01/09/2099 · 21:00 a 23:30"));
    assert.ok(text.indexOf("25/08/2099") < text.indexOf("01/09/2099"), "orden preservado");
});

test("E. the summary lists ticket types with formatted price and quantity", () => {
    const text = buildWhatsappEventSummaryText(FULL_DRAFT);
    assert.ok(text.includes("• General · $20.000 · 100 disponibles"));
    assert.ok(text.includes("• VIP · $45.000 · 20 disponibles"));
});

test("E. a free event with no ticket types shows a clear message, never an empty list", () => {
    const text = buildWhatsappEventSummaryText(MINIMAL_DRAFT);
    assert.ok(text.includes("Evento gratuito, sin control de acceso"));
});

test("E. missing optionals (no video, no social) show 'No', never undefined/null/raw", () => {
    const text = buildWhatsappEventSummaryText(MINIMAL_DRAFT);
    assert.ok(text.includes("🎬 YouTube: No"));
    assert.ok(text.includes("📱 Redes sociales: No"));
    assert.ok(!text.includes("undefined"));
    assert.ok(!text.includes("null"));
});

test("E. present optionals (video, social) show 'Sí'", () => {
    const text = buildWhatsappEventSummaryText(FULL_DRAFT);
    assert.ok(text.includes("🎬 YouTube: Sí"));
    assert.ok(text.includes("📱 Redes sociales: Sí"));
});

test("E. the summary never leaks JSON/raw internals (no braces, no _key, no _functionsDraft)", () => {
    const text = buildWhatsappEventSummaryText(FULL_DRAFT);
    assert.ok(!text.includes("{"));
    assert.ok(!text.includes("_key"));
    assert.ok(!text.includes("_functionsDraft"));
});

test("E. many functions/ticket types stay readable: capped with a '...y N más' summary line", () => {
    const manyFunctions = Array.from({ length: 15 }, (_, i) => ({ date: "2099-08-25", startTime: "20:00", endTime: "22:00" }));
    const draft = { ...MINIMAL_DRAFT, functions: manyFunctions };
    const text = buildWhatsappEventSummaryText(draft);
    const bulletCount = (text.match(/^• /gm) ?? []).length;
    assert.ok(bulletCount <= 10, "nunca lista más de 10 funciones");
    assert.ok(text.includes("más"));
});

// ==================================================
// extractWhatsappReplyText — PREVIEW: resumen + menú, siempre (primera vez
// y en cualquier reintento, con o sin error).
// ==================================================

test("extractWhatsappReplyText for PREVIEW shows the real summary + the 1/2/3 menu, replacing the old generic text", () => {
    const text = extractWhatsappReplyText(previewState(MINIMAL_DRAFT));
    assert.ok(text.includes("📋 RESUMEN DEL EVENTO"));
    assert.ok(text.includes("¿Qué querés hacer?"));
    assert.ok(text.includes("1. Publicar evento"));
    assert.ok(text.includes("2. Guardar como borrador"));
    assert.ok(text.includes("3. Volver y corregir"));
    assert.ok(!text.includes("terminá de revisarlo"));
    assert.ok(!text.includes("PUBLISH"));
});

test("extractWhatsappReplyText for PREVIEW with an error still shows the full summary + menu", () => {
    const text = extractWhatsappReplyText(previewState(MINIMAL_DRAFT, "No pudimos guardar el evento, intentá de nuevo."));
    assert.ok(text.startsWith("⚠️ No pudimos guardar el evento"));
    assert.ok(text.includes("📋 RESUMEN DEL EVENTO"));
    assert.ok(text.includes("¿Qué querés hacer?"));
});

// ==================================================
// F. Acción final — mapping real 1/2/3, nunca PUBLISH/DRAFT/EDIT crudo.
// ==================================================

test("resolveWhatsappPreviewChoice: 1->PUBLISH, 2->DRAFT, 3->BACK, anything else->null", () => {
    assert.equal(resolveWhatsappPreviewChoice("1"), "PUBLISH");
    assert.equal(resolveWhatsappPreviewChoice("2"), "DRAFT");
    assert.equal(resolveWhatsappPreviewChoice("3"), "BACK");
    assert.equal(resolveWhatsappPreviewChoice("Publish"), null);
    assert.equal(resolveWhatsappPreviewChoice("Ok"), null);
});

test('F. "1" sends the REAL action {action:"PUBLISH"} to the engine, never the raw text', async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", done: true, status: "PUBLISHED", event: { id: "evt1", slug: "fiesta-aniversario" } }),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "PUBLISH" }]);
    assert.ok(sendCalls[0].text.startsWith("✅ Evento publicado correctamente."));
});

test('F. "2" sends {action:"DRAFT"} to the engine', async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", done: true, status: "DRAFT_SAVED", event: { id: "evt1", slug: "show-gratuito" } }),
    });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "DRAFT" }]);
    assert.ok(sendCalls[0].text.startsWith("✅ Evento guardado como borrador."));
});

test('F. "3" sends the real BACK action, never an invented EDIT navigation', async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "ADD_ANOTHER_SOCIAL", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar otra red?" } }),
    });

    await processInboundMessage(textMessage({ text: "3" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.ok(sendCalls[0].text.startsWith("¿Querés agregar otra red?"));
});

test('F. "volver" is equivalent to "3"', async () => {
    const { deps } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "ADD_ANOTHER_SOCIAL", type: "QUESTION", inputType: "YES_NO", text: "¿Querés agregar otra red?" } }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
});

// Regresión DIRECTA del bug reportado: "Ok"/"Publish" nunca deben llegar
// crudos al motor — la respuesta esperada es siempre el menú, nunca "Elegí
// PUBLISH, DRAFT o EDIT".
test('F. free text ("Ok", "Publish") NEVER reaches the engine as raw text — always shows the 1/2/3 menu instead', async () => {
    for (const freeText of ["Ok", "Publish", "publicar"]) {
        const { deps, sendCalls } = baseDeps();
        await processInboundMessage(textMessage({ text: freeText }), deps);
        assert.equal(deps.handleConversationInput.calls.length, 0, `"${freeText}" nunca debe llamar al motor`);
        assert.equal(sendCalls[0].text, WHATSAPP_PREVIEW_INVALID_TEXT);
        assert.ok(!sendCalls[0].text.includes("PUBLISH"));
    }
});

test("F. never asks the user to type PUBLISH/DRAFT/EDIT literally", async () => {
    const { sendCalls } = await (async () => {
        const { deps, sendCalls } = baseDeps();
        await processInboundMessage(textMessage({ text: "no sé" }), deps);
        return { sendCalls };
    })();
    assert.ok(!sendCalls[0].text.includes("PUBLISH"));
    assert.ok(!sendCalls[0].text.includes("DRAFT"));
    assert.ok(!sendCalls[0].text.includes("EDIT"));
});

test("F. a rejection (commit error) keeps the conversation recoverable — same PREVIEW, full summary + menu shown again", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy(previewState(MINIMAL_DRAFT, "No pudimos guardar el evento, intentá de nuevo.")),
    });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.ok(sendCalls[0].text.startsWith("⚠️ No pudimos guardar el evento"));
    assert.ok(sendCalls[0].text.includes("📋 RESUMEN DEL EVENTO"));
    assert.ok(sendCalls[0].text.includes("¿Qué querés hacer?"));
});

test("a text message while the engine is not on PREVIEW is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", inputType: "SHORT_TEXT", text: "¿Cómo se llama tu evento?" } }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "DESCRIPTION", type: "QUESTION", inputType: "SHORT_TEXT", text: "Contanos de qué trata tu evento." } }),
    });

    await processInboundMessage(textMessage({ text: "Fiesta Aniversario" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Fiesta Aniversario" }]);
});

// ==================================================
// N/O — URL pública real al publicar, guía a la web al guardar borrador.
// ==================================================

test("N. buildWhatsappPublicEventUrl builds a real URL from FRONTEND_URL + event.slug, reusing the existing convention", () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://pasecultural.com/";
    try {
        assert.equal(buildWhatsappPublicEventUrl({ slug: "fiesta-aniversario" }), "https://pasecultural.com/evento/fiesta-aniversario");
    } finally {
        if (original === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = original;
    }
});

test("N. buildWhatsappPublicEventUrl never invents a URL when FRONTEND_URL or slug is missing", () => {
    const original = process.env.FRONTEND_URL;
    try {
        delete process.env.FRONTEND_URL;
        assert.equal(buildWhatsappPublicEventUrl({ slug: "x" }), null);
        process.env.FRONTEND_URL = "https://pasecultural.com";
        assert.equal(buildWhatsappPublicEventUrl({ slug: null }), null);
        assert.equal(buildWhatsappPublicEventUrl(null), null);
    } finally {
        if (original === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = original;
    }
});

test("O. saving as draft tells the organizer to use the web to publish/edit later, never a fabricated action", () => {
    const text = extractWhatsappReplyText({ conversationId: "conv1", done: true, status: "DRAFT_SAVED", event: { id: "evt1" } });
    assert.equal(text, "✅ Evento guardado como borrador.\n\nPara editarlo o publicarlo más adelante, ingresá a la web de PaseCultural.");
});

test("buildWhatsappPreviewMenuText is the exact menu text used everywhere", () => {
    assert.equal(buildWhatsappPreviewMenuText(), "¿Qué querés hacer?\n\n1. Publicar evento\n2. Guardar como borrador\n3. Volver y corregir\n\nRespondé con el número de la opción.");
});
