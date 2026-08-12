import test from "node:test";
import assert from "node:assert/strict";
import { processInboundMessage } from "../src/controllers/whatsapp.controller.js";
import {
    resolveWhatsappTicketNameOptionId,
    parseWhatsappTicketPriceText,
    parseWhatsappTicketComboText,
    buildWhatsappTicketComboPromptText,
    buildWhatsappTicketComboInvalidText,
    extractWhatsappReplyText,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3K, sección 11 — step TICKET_NAME: colapsa nombre + precio en UN
// mensaje ("General, 8000") en vez de 2 preguntas (selector numerado de 7
// opciones + "Otro", y precio por separado). CRÍTICO (instrucción
// explícita, repetida en el pedido): el precio se ENSEÑA siempre SIN el
// signo $ — "Escribí el nombre y el precio... Ingresá el valor sin el
// signo $" — el bot nunca debe enseñar "General, $8000" ni "General,
// $8.000"; el parser SÍ tolera "$8000"/"8.000" si el organizador lo
// escribe así (estricto en lo que enseña, tolerante en lo que entiende).

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

function sequentialSpy(returnValues) {
    const calls = [];
    let i = 0;
    const fn = async (...args) => {
        calls.push(args);
        const value = returnValues[Math.min(i, returnValues.length - 1)];
        i += 1;
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value(...args) : value;
    };
    fn.calls = calls;
    return fn;
}

const TICKET_NAME_STEP_STATE = {
    conversationId: "conv1",
    prompt: { stepId: "TICKET_NAME", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Qué tipo de entrada querés agregar primero?" },
    canGoBack: true,
    sections: [],
};

function baseDeps({ resumeConversation, handleConversationInput, ...overrides } = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy({ id: "conv1", userId: "user_123" }),
            resumeConversation: resumeConversation ?? spy(TICKET_NAME_STEP_STATE),
            handleConversationInput: handleConversationInput ?? spy(TICKET_NAME_STEP_STATE),
            cancelConversation: spy(undefined),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

const TICKET_QUANTITY_RESULT = {
    conversationId: "conv1",
    prompt: { stepId: "TICKET_QUANTITY", type: "QUESTION", inputType: "POSITIVE_INT", text: "¿Cuántas entradas de este tipo tenés disponibles?" },
};

// ==================================================
// parsers puros
// ==================================================

test("resolveWhatsappTicketNameOptionId matches known names case/accent-insensitively", () => {
    assert.equal(resolveWhatsappTicketNameOptionId("General"), "General");
    assert.equal(resolveWhatsappTicketNameOptionId("general"), "General");
    assert.equal(resolveWhatsappTicketNameOptionId("GENERAL"), "General");
    assert.equal(resolveWhatsappTicketNameOptionId("vip"), "VIP");
    assert.equal(resolveWhatsappTicketNameOptionId("platea"), "Platea");
    assert.equal(resolveWhatsappTicketNameOptionId("anticipada"), "Anticipada");
});

test("resolveWhatsappTicketNameOptionId falls back to 'OTHER' for a free custom name, never rejecting it", () => {
    assert.equal(resolveWhatsappTicketNameOptionId("Palco VIP Premium"), "OTHER");
    assert.equal(resolveWhatsappTicketNameOptionId("Entrada especial"), "OTHER");
});

test("parseWhatsappTicketPriceText: taught format (plain digits, no $) parses correctly", () => {
    assert.equal(parseWhatsappTicketPriceText("8000"), 8000);
    assert.equal(parseWhatsappTicketPriceText("0"), 0);
});

test("parseWhatsappTicketPriceText tolerates natural variants it was never taught: '$8000', '$8.000', '8,000'", () => {
    assert.equal(parseWhatsappTicketPriceText("$8000"), 8000);
    assert.equal(parseWhatsappTicketPriceText("$8.000"), 8000);
    assert.equal(parseWhatsappTicketPriceText("8,000"), 8000);
    assert.equal(parseWhatsappTicketPriceText(" 8000 "), 8000);
});

for (const invalid of ["", "gratis", null, undefined]) {
    test(`parseWhatsappTicketPriceText rejects "${invalid}"`, () => {
        assert.equal(parseWhatsappTicketPriceText(invalid), null);
    });
}

test("parseWhatsappTicketComboText splits on the LAST comma into {name, price}", () => {
    assert.deepEqual(parseWhatsappTicketComboText("General, 8000"), { name: "General", price: 8000 });
    assert.deepEqual(parseWhatsappTicketComboText("VIP,15000"), { name: "VIP", price: 15000 });
});

test("parseWhatsappTicketComboText tolerates a comma inside the name itself (splits on the LAST comma)", () => {
    assert.deepEqual(parseWhatsappTicketComboText("Mesa, con vista, 20000"), { name: "Mesa, con vista", price: 20000 });
});

for (const invalid of ["General", "8000", "", ", 8000", "General,", "General, gratis"]) {
    test(`parseWhatsappTicketComboText rejects "${invalid}"`, () => {
        assert.equal(parseWhatsappTicketComboText(invalid), null);
    });
}

test("parseWhatsappTicketComboText never throws on non-string input", () => {
    assert.equal(parseWhatsappTicketComboText(null), null);
    assert.equal(parseWhatsappTicketComboText(undefined), null);
});

// ==================================================
// texto enseñado — CRÍTICO: nunca $ en el ejemplo, siempre explícito
// "sin el signo $".
// ==================================================

test("buildWhatsappTicketComboPromptText teaches 'Nombre, Precio' with a real example that never includes the $ sign, and explicitly says to omit it", () => {
    const text = buildWhatsappTicketComboPromptText("¿Qué tipo de entrada querés agregar primero?");
    assert.ok(text.startsWith("¿Qué tipo de entrada querés agregar primero?"));
    assert.ok(text.includes("Ejemplo:\nGeneral, 8000"));
    assert.ok(!text.includes("General, $8000") && !text.includes("General, $8.000"), "el ejemplo enseñado nunca debe llevar el signo $");
    assert.ok(text.toLowerCase().includes("sin el signo $"));
});

test("buildWhatsappTicketComboInvalidText also teaches the no-$ format with a real example", () => {
    const text = buildWhatsappTicketComboInvalidText();
    assert.ok(text.includes("General, 8000"));
    assert.ok(!text.includes("General, $8000") && !text.includes("General, $8.000"));
});

test("extractWhatsappReplyText renders the compact combo prompt for TICKET_NAME, preserving the engine's own question text", () => {
    const text = extractWhatsappReplyText(TICKET_NAME_STEP_STATE);
    assert.equal(text, buildWhatsappTicketComboPromptText("¿Qué tipo de entrada querés agregar primero?"));
});

// ==================================================
// subflujo — nombre conocido: 2 llamadas al motor (TICKET_NAME, TICKET_PRICE).
// ==================================================

test("a known ticket name ('General, 8000') calls the engine exactly twice: TICKET_NAME with the resolved id, TICKET_PRICE with the plain integer", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([TICKET_NAME_STEP_STATE, TICKET_QUANTITY_RESULT]),
    });

    await processInboundMessage(textMessage({ text: "General, 8000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "General" }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: 8000 }]);
    assert.equal(sendCalls[0].text, "¿Cuántas entradas de este tipo tenés disponibles?");
});

test("the parser tolerates '$8.000' even though it's never taught, still calling the engine with the plain integer 8000", async () => {
    const { deps } = baseDeps({
        handleConversationInput: sequentialSpy([TICKET_NAME_STEP_STATE, TICKET_QUANTITY_RESULT]),
    });

    await processInboundMessage(textMessage({ text: "General, $8.000" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: 8000 }]);
});

// ==================================================
// subflujo — nombre personalizado: 3 llamadas al motor (TICKET_NAME=OTHER,
// TICKET_NAME_CUSTOM, TICKET_PRICE).
// ==================================================

test("a custom ticket name not in the known list ('Palco Familiar, 20000') routes through TICKET_NAME_CUSTOM, calling the engine exactly three times", async () => {
    const customNameStepState = {
        conversationId: "conv1",
        prompt: { stepId: "TICKET_NAME_CUSTOM", type: "QUESTION", inputType: "SHORT_TEXT", text: "Escribí el nombre de la entrada." },
    };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([customNameStepState, TICKET_NAME_STEP_STATE, TICKET_QUANTITY_RESULT]),
    });

    await processInboundMessage(textMessage({ text: "Palco Familiar, 20000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 3);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "OTHER" }]);
    assert.deepEqual(deps.handleConversationInput.calls[1], ["conv1", { value: "Palco Familiar" }]);
    assert.deepEqual(deps.handleConversationInput.calls[2], ["conv1", { value: 20000 }]);
    assert.equal(sendCalls[0].text, "¿Cuántas entradas de este tipo tenés disponibles?");
});

// ==================================================
// malformado / rechazos del motor
// ==================================================

for (const invalid of ["General", "sin coma ni precio", "General, gratis"]) {
    test(`a malformed combo ("${invalid}") never calls the engine, explains the taught format`, async () => {
        const { deps, sendCalls } = baseDeps();

        await processInboundMessage(textMessage({ text: invalid }), deps);

        assert.equal(deps.handleConversationInput.calls.length, 0);
        assert.equal(sendCalls[0].text, buildWhatsappTicketComboInvalidText());
    });
}

test("if the engine rejects the resolved name (defensive path), the price is never sent and a clear message is shown", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "TICKET_NAME", type: "QUESTION", text: "x", error: "algo inesperado" } }),
    });

    await processInboundMessage(textMessage({ text: "General, 8000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1, "el precio nunca se envía si el nombre ya fue rechazado");
    assert.equal(sendCalls[0].text, buildWhatsappTicketComboInvalidText());
});

test("if the engine rejects the custom name (defensive path), the price is never sent", async () => {
    const customNameStepState = {
        conversationId: "conv1",
        prompt: { stepId: "TICKET_NAME_CUSTOM", type: "QUESTION", inputType: "SHORT_TEXT", text: "Escribí el nombre de la entrada." },
    };
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([
            customNameStepState,
            { conversationId: "conv1", prompt: { stepId: "TICKET_NAME_CUSTOM", type: "QUESTION", text: "x", error: "algo inesperado" } },
        ]),
    });

    await processInboundMessage(textMessage({ text: "Palco Familiar, 20000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2, "se intenta OTHER, luego el nombre libre (rechazado), nunca el precio");
    assert.equal(sendCalls[0].text, buildWhatsappTicketComboInvalidText());
});

test("if the engine rejects the final price (defensive path), a clear message is shown after all name calls", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: sequentialSpy([
            TICKET_NAME_STEP_STATE,
            { conversationId: "conv1", prompt: { stepId: "TICKET_PRICE", type: "QUESTION", text: "x", error: "algo inesperado" } },
        ]),
    });

    await processInboundMessage(textMessage({ text: "General, 8000" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 2);
    assert.equal(sendCalls[0].text, buildWhatsappTicketComboInvalidText());
});

// ==================================================
// volver / no interceptar fuera de TICKET_NAME
// ==================================================

test("'volver' on TICKET_NAME uses the engine's real BACK", async () => {
    const { deps, sendCalls } = baseDeps({
        handleConversationInput: spy({
            conversationId: "conv1",
            prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "x", options: [{ id: "PAID", label: "Pago" }] },
        }),
    });

    await processInboundMessage(textMessage({ text: "volver" }), deps);

    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { action: "BACK" }]);
    assert.ok(sendCalls[0].text.includes("Pago"));
});

test("a text message while the engine is not on TICKET_NAME is never intercepted by this sub-flow", async () => {
    const { deps } = baseDeps({
        resumeConversation: spy({
            conversationId: "conv1",
            prompt: { stepId: "TICKET_QUANTITY", type: "QUESTION", inputType: "POSITIVE_INT", text: "¿Cuántas entradas de este tipo tenés disponibles?" },
        }),
        handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "ADD_ANOTHER_TICKET", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Querés agregar otro tipo de entrada?", options: [] } }),
    });

    await processInboundMessage(textMessage({ text: "50" }), deps);

    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "50" }]);
});

test("cancelling never touches the ticket-combo machinery — cancelConversation runs first and short-circuits", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.ok(sendCalls[0].text.includes("Cancelamos"));
});
