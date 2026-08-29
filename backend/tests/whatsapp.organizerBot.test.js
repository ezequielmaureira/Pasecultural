import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoReply, AUTO_REPLY_TEXT } from "../src/services/whatsapp.service.js";
import {
    classifyInitialIntent,
    isCancelCommand,
    isBackCommand,
    extractWhatsappReplyText,
    resolveSingleSelectIndexReply,
    WHATSAPP_DECLINE_TEXT,
    WHATSAPP_CANCEL_TEXT,
    WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT,
    WHATSAPP_SELECTION_INVALID_TEXT,
    buildKnownOrganizationGreetingText,
    buildGenericPublishIntentGreetingText,
    buildOrganizationSelectorText,
} from "../src/services/whatsappOrganizerBot.service.js";
import { processInboundMessage, processInboundMessages } from "../src/controllers/whatsapp.controller.js";

function textMessage(overrides = {}) {
    return {
        messageId: "wamid.IN1",
        from: "5491122334455",
        type: "text",
        timestamp: "1700000000",
        text: "Hola",
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

// deps base (Fase 2G): sin conversación activa, sin selección pendiente, y
// discoverCandidates resuelve por default a UNA sola Organization APPROVED
// (Caso A) — cada test override lo que necesite. Ninguna de estas funciones
// es la real (todas tocarían Prisma): son mocks para poder probar el
// cableo del controller sin base de datos.
function baseDeps(overrides = {}) {
    const { sendText, calls: sendCalls } = fakeSender();
    return {
        deps: {
            sendText,
            findActiveConversation: spy(null),
            startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
            handleConversationInput: spy({ conversationId: "conv1", prompt: { stepId: "DESCRIPTION", type: "QUESTION", text: "¿De qué trata tu evento?" }, canGoBack: true, sections: [] }),
            cancelConversation: spy(undefined),
            discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
            getPendingSelection: spy(null),
            createPendingSelection: spy(undefined),
            clearPendingSelection: spy(undefined),
            resolveOwner: spy({ name: "Elvis Bar", clerkId: "user_123" }),
            // Premium — Fase 2C. Este archivo no prueba el feature gate
            // (salvo los tests explícitos de esta sección) — por default
            // PREMIUM preserva el comportamiento histórico.
            getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
            // Fase 3C — el sub-flujo de FUNCTIONS_SINGLE_CARD se consulta
            // SIEMPRE que hay conversación activa (ver
            // whatsapp.controller.js#tryHandleFunctionCardSubflow). Ninguno
            // de los tests de este archivo ejercita ese step, así que estos
            // defaults simplemente confirman "no hay pending, y el step
            // actual tampoco es FUNCTIONS_SINGLE_CARD" para que el árbol de
            // decisión caiga siempre al camino SINGLE_SELECT que sí se
            // está probando acá.
            resumeConversation: spy({ conversationId: "conv1", prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT" }, canGoBack: true, sections: [] }),
            getPendingStepInput: spy(null),
            resetPendingStepInput: spy(undefined),
            updatePendingStepInputStatus: spy(undefined),
            deletePendingStepInput: spy(undefined),
            ...overrides,
        },
        sendCalls,
    };
}

// ==================================================
// shouldAutoReply — pura, sin cambios de comportamiento en esta fase
// ==================================================

test("shouldAutoReply is true for a valid non-empty text message", () => {
    assert.equal(shouldAutoReply(textMessage()), true);
});

test("shouldAutoReply is false when text is null", () => {
    assert.equal(shouldAutoReply(textMessage({ text: null })), false);
});

test("shouldAutoReply is false when text is empty or whitespace-only", () => {
    assert.equal(shouldAutoReply(textMessage({ text: "" })), false);
    assert.equal(shouldAutoReply(textMessage({ text: "   " })), false);
});

test("shouldAutoReply is false for a non-text message type", () => {
    assert.equal(shouldAutoReply(textMessage({ type: "image", text: null })), false);
});

test("shouldAutoReply is false when from is missing", () => {
    assert.equal(shouldAutoReply(textMessage({ from: null })), false);
});

// ==================================================
// classifyInitialIntent — pura, sin IA (sección 4)
// ==================================================

test("classifyInitialIntent recognizes the documented affirmative phrases", () => {
    for (const text of ["sí", "Si", "S", "dale", "OK", "quiero", "quiero publicar", "Publicar", "crear", "crear evento"]) {
        assert.equal(classifyInitialIntent(text), "AFFIRMATIVE", `esperaba AFFIRMATIVE para "${text}"`);
    }
});

test("classifyInitialIntent recognizes the documented negative phrases", () => {
    for (const text of ["no", "No gracias", "ahora no", "Después", "DESPUES"]) {
        assert.equal(classifyInitialIntent(text), "NEGATIVE", `esperaba NEGATIVE para "${text}"`);
    }
});

test("classifyInitialIntent normalizes case, accents, spaces and simple punctuation", () => {
    assert.equal(classifyInitialIntent("  Sí!  "), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent("¿Sí?"), "AFFIRMATIVE");
});

test("classifyInitialIntent returns UNKNOWN for anything else, including empty/non-string input", () => {
    assert.equal(classifyInitialIntent("Hola"), "UNKNOWN");
    assert.equal(classifyInitialIntent("asdkjh"), "UNKNOWN");
    assert.equal(classifyInitialIntent(""), "UNKNOWN");
    assert.equal(classifyInitialIntent(null), "UNKNOWN");
});

// Fase 3D, sección 2 — el saludo inicial ahora también muestra "1. Sí /
// 2. No": "1"/"2" se aceptan como equivalentes exactos, SIN romper las
// frases textuales de siempre (ya probadas arriba).
test("classifyInitialIntent accepts '1' as AFFIRMATIVE and '2' as NEGATIVE", () => {
    assert.equal(classifyInitialIntent("1"), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent("2"), "NEGATIVE");
});

test("classifyInitialIntent tolerates whitespace around 1/2", () => {
    assert.equal(classifyInitialIntent("  1  "), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent(" 2 "), "NEGATIVE");
});

test("classifyInitialIntent rejects any other number (only 1/2 are meaningful here)", () => {
    assert.equal(classifyInitialIntent("3"), "UNKNOWN");
    assert.equal(classifyInitialIntent("0"), "UNKNOWN");
});

test("classifyInitialIntent still recognizes the textual Sí/No phrases exactly as before, unaffected by the 1/2 addition", () => {
    assert.equal(classifyInitialIntent("Sí"), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent("si"), "AFFIRMATIVE");
    assert.equal(classifyInitialIntent("No"), "NEGATIVE");
});

// ==================================================
// isCancelCommand — pura (sección 8)
// ==================================================

test("isCancelCommand recognizes cancelar/cancel/salir regardless of case or simple punctuation", () => {
    assert.equal(isCancelCommand("cancelar"), true);
    assert.equal(isCancelCommand("Cancel"), true);
    assert.equal(isCancelCommand("SALIR!"), true);
});

test("isCancelCommand is false for anything else", () => {
    assert.equal(isCancelCommand("Hola"), false);
    assert.equal(isCancelCommand(""), false);
});

// ==================================================
// isBackCommand — Fase 3D, sección 7. Case-insensitive, tolera espacios
// externos (mismo criterio que isCancelCommand, vía normalizeIntentText).
// ==================================================

test("isBackCommand recognizes 'volver' regardless of case", () => {
    assert.equal(isBackCommand("volver"), true);
    assert.equal(isBackCommand("Volver"), true);
    assert.equal(isBackCommand("VOLVER"), true);
});

test("isBackCommand tolerates surrounding whitespace", () => {
    assert.equal(isBackCommand("  volver  "), true);
    assert.equal(isBackCommand(" VOLVER "), true);
});

test("isBackCommand is false for anything else, including cancel commands", () => {
    assert.equal(isBackCommand("Hola"), false);
    assert.equal(isBackCommand("cancelar"), false);
    assert.equal(isBackCommand(""), false);
    assert.equal(isBackCommand(null), false);
});

// ==================================================
// extractWhatsappReplyText — adapter motor -> texto WhatsApp (sección 7)
// ==================================================

test("extractWhatsappReplyText returns the question text as-is for a normal QUESTION prompt", () => {
    const result = { prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" } };
    assert.equal(extractWhatsappReplyText(result), "¿Cómo se llama tu evento?");
});

test("extractWhatsappReplyText prefixes the validation error before the re-asked question", () => {
    const result = { prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?", error: "Contame un poco más, no puede quedar vacío." } };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("Contame un poco más"));
    assert.ok(text.includes("¿Cómo se llama tu evento?"));
    assert.ok(text.indexOf("Contame un poco más") < text.indexOf("¿Cómo se llama tu evento?"));
});

test("extractWhatsappReplyText never leaks the raw draft for a PREVIEW prompt", () => {
    const result = { prompt: { stepId: "PREVIEW", type: "PREVIEW", draft: { title: "Fiesta", secretInternalField: "no debería salir" } } };
    const text = extractWhatsappReplyText(result);
    assert.equal(typeof text, "string");
    assert.ok(!text.includes("secretInternalField"));
});

test("extractWhatsappReplyText builds a finalization message when the engine reports done", () => {
    assert.match(extractWhatsappReplyText({ done: true, status: "PUBLISHED" }), /public/i);
    assert.match(extractWhatsappReplyText({ done: true, status: "DRAFT_SAVED" }), /borrador/i);
});

test("extractWhatsappReplyText returns null when there is nothing to send", () => {
    assert.equal(extractWhatsappReplyText(null), null);
    assert.equal(extractWhatsappReplyText({ conversationId: "conv1" }), null);
});

// ==================================================
// Bug fix: un step SINGLE_SELECT (CATEGORY y cualquier otro, ver
// steps/definitions.js) manda su prompt con `options` — antes
// extractWhatsappReplyText las descartaba silenciosamente y WhatsApp se
// quedaba sin mostrar nada para elegir. El renderer es genérico: nunca
// hardcodea categorías ni ningún otro step, sólo lee prompt.options.
// ==================================================

const CATEGORY_OPTIONS = [
    { id: "MUSICA", label: "Música" },
    { id: "TEATRO", label: "Teatro" },
    { id: "GASTRONOMIA", label: "Gastronomía" },
    { id: "DEPORTES", label: "Deportes" },
];

test("extractWhatsappReplyText lists every option of a SINGLE_SELECT step, numbered", () => {
    const result = {
        prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: CATEGORY_OPTIONS },
    };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("Elegí la categoría de tu evento."));
    for (const option of CATEGORY_OPTIONS) {
        assert.ok(text.includes(option.label), `esperaba ver "${option.label}" en el mensaje`);
    }
    assert.ok(/respond[eé]/i.test(text));
});

test("extractWhatsappReplyText numbers the options in the exact order the engine returned them", () => {
    const result = {
        prompt: { stepId: "CATEGORY", type: "QUESTION", inputType: "SINGLE_SELECT", text: "Elegí la categoría de tu evento.", options: CATEGORY_OPTIONS },
    };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("1. Música"));
    assert.ok(text.includes("2. Teatro"));
    assert.ok(text.includes("3. Gastronomía"));
    assert.ok(text.includes("4. Deportes"));
    assert.ok(text.indexOf("1. Música") < text.indexOf("2. Teatro"));
    assert.ok(text.indexOf("2. Teatro") < text.indexOf("3. Gastronomía"));
    assert.ok(text.indexOf("3. Gastronomía") < text.indexOf("4. Deportes"));
});

test("extractWhatsappReplyText re-shows the options together with a validation error", () => {
    const result = {
        prompt: {
            stepId: "CATEGORY",
            type: "QUESTION",
            inputType: "SINGLE_SELECT",
            text: "Elegí la categoría de tu evento.",
            options: CATEGORY_OPTIONS,
            error: "Elegí una de las opciones que te muestro.",
        },
    };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("Elegí una de las opciones que te muestro."));
    assert.ok(text.includes("1. Música"));
    assert.ok(text.indexOf("Elegí una de las opciones que te muestro.") < text.indexOf("1. Música"));
});

test("extractWhatsappReplyText never lists options for a step that doesn't have any", () => {
    const result = { prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" } };
    assert.equal(extractWhatsappReplyText(result), "¿Cómo se llama tu evento?");
});

test("extractWhatsappReplyText works generically for a different SINGLE_SELECT step, not just CATEGORY", () => {
    const pricingOptions = [
        { id: "FREE", label: "Gratuito" },
        { id: "PAID", label: "De pago" },
    ];
    const result = {
        prompt: { stepId: "EVENT_PRICING_TYPE", type: "QUESTION", inputType: "SINGLE_SELECT", text: "¿Este evento es gratuito o de pago?", options: pricingOptions },
    };
    const text = extractWhatsappReplyText(result);
    assert.ok(text.includes("1. Gratuito"));
    assert.ok(text.includes("2. De pago"));
});

// ==================================================
// resolveSingleSelectIndexReply — adaptador WhatsApp: índice 1-based ->
// id real de la lista EXACTA que se mostró. Nunca acepta 0, negativos,
// fuera de rango, ni texto libre; nunca inventa un id fuera de `options`.
// ==================================================

test("resolveSingleSelectIndexReply: a valid 1-based index resolves the matching option id", () => {
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "1"), "MUSICA");
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "4"), "DEPORTES");
});

test("resolveSingleSelectIndexReply: the first index selects the first real option, the last index selects the last", () => {
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "1"), CATEGORY_OPTIONS[0].id);
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, String(CATEGORY_OPTIONS.length)), CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1].id);
});

test("resolveSingleSelectIndexReply: rejects index 0", () => {
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "0"), null);
});

test("resolveSingleSelectIndexReply: rejects an out-of-range index", () => {
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "5"), null);
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "999"), null);
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "-1"), null);
});

test("resolveSingleSelectIndexReply: invalid/free text never silently selects another option", () => {
    for (const rawText of ["hola", "MUSICA", "1.5", "uno", "", null, undefined]) {
        assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, rawText), null, `esperaba null para "${rawText}"`);
    }
});

test("resolveSingleSelectIndexReply: tolerates surrounding whitespace around a valid index", () => {
    assert.equal(resolveSingleSelectIndexReply(CATEGORY_OPTIONS, "  1  "), "MUSICA");
});

test("resolveSingleSelectIndexReply: works generically with any other options list, not just category", () => {
    const pricingOptions = [
        { id: "FREE", label: "Gratuito" },
        { id: "PAID", label: "De pago" },
    ];
    assert.equal(resolveSingleSelectIndexReply(pricingOptions, "1"), "FREE");
    assert.equal(resolveSingleSelectIndexReply(pricingOptions, "2"), "PAID");
    assert.equal(resolveSingleSelectIndexReply(pricingOptions, "3"), null);
});

test("resolveSingleSelectIndexReply: null/empty options list never resolves anything", () => {
    assert.equal(resolveSingleSelectIndexReply([], "1"), null);
    assert.equal(resolveSingleSelectIndexReply(null, "1"), null);
    assert.equal(resolveSingleSelectIndexReply(undefined, "1"), null);
});

// ==================================================
// processInboundMessage — árbol de decisión Fase 2G (identificación por
// teléfono + selección entre varias Organizations). El viejo flujo de
// challenge/código de 6 dígitos (Fase 2F) ya no es parte de este árbol —
// ver el test dedicado más abajo que confirma que nunca se dispara.
// ==================================================

// Caso A: exactamente una Organization APPROVED coincide con el teléfono.
// Fase 3K, sección 1 — identifica a la PERSONA primero ("Hola Ezequiel 👋"),
// nunca sólo a la organización. resolvePersonFirstName exige que TODOS los
// candidatos compartan el mismo clerkId (ver whatsappOrganizerBot.service.js) —
// acá hay uno solo, así que siempre se cumple.
test("Caso A) single matching organization + 'Hola' greets the PERSON by name first, then asks about the organization, never starting the engine", async () => {
    const { deps, sendCalls } = baseDeps({
        discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123", ownerFirstName: "Ezequiel" }]),
    });

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.createPendingSelection.calls.length, 0);
    assert.equal(sendCalls[0].text, buildKnownOrganizationGreetingText("Ezequiel", "Elvis Bar"));
    assert.ok(sendCalls[0].text.startsWith("Hola Ezequiel 👋"));
});

// Sin firstName resoluble (ej. el owner nunca cargó su nombre real) cae al
// saludo genérico "¡Hola! 👋" — nunca se inventa un nombre, y la organización
// sigue nombrándose igual.
test("Caso A) without a resolvable owner first name, falls back to the generic '¡Hola!' greeting, still naming the organization", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(sendCalls[0].text, buildKnownOrganizationGreetingText(null, "Elvis Bar"));
    assert.ok(sendCalls[0].text.startsWith("¡Hola! 👋"));
});

test("Caso A) single matching organization + 'Sí' calls EventCreationEngine.start exactly once with that organizationId", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Sí", from: "5491100001111" }), deps);

    assert.equal(deps.startConversation.calls.length, 1);
    assert.deepEqual(deps.startConversation.calls[0][0], {
        clerkId: "user_123",
        channel: "WHATSAPP",
        channelRef: "5491100001111",
        organizationId: "org_1",
    });
    assert.equal(sendCalls[0].text, "¿Cómo se llama tu evento?");
});

// Fase 3D, sección 2/27 — el mismo saludo ahora también acepta "1"/"2",
// sin romper "Sí"/"No" textual (test anterior).
test("Caso A) single matching organization + '1' (numbered Sí) calls EventCreationEngine.start exactly once", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "1", from: "5491100001111" }), deps);

    assert.equal(deps.startConversation.calls.length, 1);
    assert.deepEqual(deps.startConversation.calls[0][0], {
        clerkId: "user_123",
        channel: "WHATSAPP",
        channelRef: "5491100001111",
        organizationId: "org_1",
    });
    assert.equal(sendCalls[0].text, "¿Cómo se llama tu evento?");
});

test("Caso A) single matching organization + '2' (numbered No) never starts the engine, same as textual 'No'", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);
});

test("Caso A) the greeting itself shows the numbered 1/2 format", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.ok(sendCalls[0].text.includes("1. Sí"));
    assert.ok(sendCalls[0].text.includes("2. No"));
});

test("Caso A) single matching organization + 'No' never starts the engine and sends the closing message", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ text: "No gracias" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);
});

// Caso C: ningún candidato — nunca se genera código/challenge, sólo se
// explica cómo corregirlo desde la web.
test("Caso C) zero matching organizations replies with the not-found message and never creates a pending selection or a challenge", async () => {
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy([]) });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.createPendingSelection.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT);
});

// Caso B: varias Organizations APPROVED comparten el teléfono — selector
// numerado explícito, en el mismo orden que discoverCandidates devolvió.
const MULTI_CANDIDATES = [
    { organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" },
    { organizationId: "org_2", name: "Elvis Multiespacio", clerkId: "user_123" },
    { organizationId: "org_3", name: "Club Central", clerkId: "user_123" },
];

test("Caso B) multiple matching organizations shows the numbered selector and never starts the engine yet", async () => {
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(MULTI_CANDIDATES) });

    await processInboundMessage(textMessage({ text: "Sí", from: "5491100003333" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.createPendingSelection.calls.length, 1);
    assert.deepEqual(deps.createPendingSelection.calls[0], ["5491100003333", ["org_1", "org_2", "org_3"]]);
    assert.equal(sendCalls[0].text, buildOrganizationSelectorText(MULTI_CANDIDATES));
});

test("Caso B) multiple matching organizations + 'No' declines without ever offering the selector", async () => {
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(MULTI_CANDIDATES) });

    await processInboundMessage(textMessage({ text: "No" }), deps);

    assert.equal(deps.createPendingSelection.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_DECLINE_TEXT);
});

// Fase 3K, sección 1 (Caso B) — antes de mostrar el selector, primero se
// pregunta la intención de forma genérica (sin poder nombrar todavía
// ninguna organización puntual) y SIN persistir ningún estado nuevo: si el
// primer mensaje no es claramente afirmativo ("Hola", texto ambiguo), se
// muestra sólo el saludo genérico — nunca el selector, nunca
// createPendingSelection.
test("Caso B) an ambiguous first message ('Hola') shows the generic greeting, never the selector, and creates no pending selection", async () => {
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(MULTI_CANDIDATES) });

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(deps.createPendingSelection.calls.length, 0);
    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, buildGenericPublishIntentGreetingText(null));
    assert.ok(sendCalls[0].text.startsWith("¡Hola! 👋"));
    assert.ok(!sendCalls[0].text.includes("Elvis Bar"), "el saludo genérico nunca nombra ninguna organización puntual");
});

// Cuando TODAS las candidatas comparten el mismo dueño, el saludo genérico
// también se personaliza con su nombre — mismo criterio que Caso A.
test("Caso B) the generic greeting is personalized with the owner's first name when every candidate shares the same clerkId", async () => {
    const sameOwnerCandidates = MULTI_CANDIDATES.map((c) => ({ ...c, ownerFirstName: "Ezequiel" }));
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(sameOwnerCandidates) });

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(sendCalls[0].text, buildGenericPublishIntentGreetingText("Ezequiel"));
    assert.ok(sendCalls[0].text.startsWith("Hola Ezequiel 👋"));
});

// Si las candidatas pertenecen a dueños distintos, nunca se adivina de
// cuál de ellos se trata — resolvePersonFirstName exige unanimidad.
test("Caso B) candidates belonging to different owners never resolve a first name — falls back to the generic greeting", async () => {
    const mixedOwnerCandidates = [
        { ...MULTI_CANDIDATES[0], ownerFirstName: "Ezequiel" },
        { ...MULTI_CANDIDATES[1], clerkId: "user_999", ownerFirstName: "Julia" },
    ];
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(mixedOwnerCandidates) });

    await processInboundMessage(textMessage({ text: "Hola" }), deps);

    assert.equal(sendCalls[0].text, buildGenericPublishIntentGreetingText(null));
});

// Una vez confirmada la intención (aunque sea en el primerísimo mensaje,
// sin haber visto el saludo genérico antes), el selector se muestra
// directamente — no obliga a un intercambio extra si el organizador ya
// sabe lo que quiere.
test("Caso B) an affirmative first message skips the generic greeting entirely and shows the selector right away", async () => {
    const { deps, sendCalls } = baseDeps({ discoverCandidates: spy(MULTI_CANDIDATES) });

    await processInboundMessage(textMessage({ text: "dale", from: "5491100003333" }), deps);

    assert.equal(deps.createPendingSelection.calls.length, 1);
    assert.deepEqual(deps.createPendingSelection.calls[0], ["5491100003333", ["org_1", "org_2", "org_3"]]);
    assert.equal(sendCalls[0].text, buildOrganizationSelectorText(MULTI_CANDIDATES));
});

// ==================================================================
// FIX (post FASE 3K) — bug real: "Cine Nadia" y "La Taberna de Mou"
// comparten teléfono; sólo Cine Nadia tenía WhatsappOrganizerLink previo.
// discoverWhatsappOrganizationCandidates ya se corrigió para devolver
// AMBAS (ver tests/whatsappOrganizerDiscovery.test.js, escenario 5) — este
// test end-to-end prueba que, una vez que discoverCandidates devuelve las
// dos, todo el resto del árbol de decisión (selector -> selección ->
// EventCreationEngine.start) funciona con el organizationId REAL elegido.
//
// Bug fix (confirmación redundante) — antes eran CUATRO mensajes (saludo,
// "1", elegir organización, "Sí" de nuevo para confirmar la MISMA elección
// que el organizador ya había hecho explícitamente). Elegir del selector YA
// es la confirmación: ahora son sólo TRES mensajes, como tres webhooks
// reales — nunca se llama ni se muestra
// buildOrganizationSelectedConfirmationText, nunca se vuelve a preguntar
// Sí/No, y la conversación arranca en el mismo mensaje que la elección.
// ==================================================================
test("REGRESSION end-to-end: Cine Nadia + La Taberna de Mou (mismo teléfono) — selector, selección de la segunda, y EventCreationEngine.start directo con el organizationId real elegido", async () => {
    const REAL_CANDIDATES = [
        { organizationId: "org_cine_nadia_real_id", name: "Cine Nadia", clerkId: "user_ezequiel" },
        { organizationId: "org_la_taberna_real_id", name: "La Taberna de Mou", clerkId: "user_ezequiel" },
    ];
    const FROM = "5492984405532";

    // Mensaje 1: saludo ambiguo -> genérico, sin selector todavía.
    const { deps: deps1, sendCalls: sendCalls1 } = baseDeps({
        discoverCandidates: spy(REAL_CANDIDATES),
    });
    await processInboundMessage(textMessage({ text: "Hola", from: FROM }), deps1);
    assert.equal(deps1.createPendingSelection.calls.length, 0);
    assert.ok(sendCalls1[0].text.includes("¿Querés publicar un evento?"));

    // Mensaje 2: "1" (afirmativo) -> selector con las DOS organizaciones
    // reales, en el orden real que devolvió el descubrimiento.
    const { deps: deps2, sendCalls: sendCalls2 } = baseDeps({
        discoverCandidates: spy(REAL_CANDIDATES),
    });
    await processInboundMessage(textMessage({ text: "1", from: FROM }), deps2);
    assert.deepEqual(deps2.createPendingSelection.calls[0], [FROM, ["org_cine_nadia_real_id", "org_la_taberna_real_id"]]);
    assert.equal(sendCalls2[0].text, "¿Con cuál de tus organizaciones querés trabajar?\n\n1. Cine Nadia\n2. La Taberna de Mou");

    // Mensaje 3: "2" -> elige La Taberna de Mou (la SEGUNDA, la que antes
    // del fix de discovery nunca aparecía) Y arranca el motor en el mismo
    // mensaje — el organizationId REAL de La Taberna de Mou llega directo a
    // EventCreationEngine.start, nunca el de Cine Nadia, nunca un valor por
    // defecto, y sin ningún mensaje de confirmación intermedio.
    const { deps: deps3, sendCalls: sendCalls3 } = baseDeps({
        getPendingSelection: spy({ status: "AWAITING_SELECTION", candidateOrganizationIds: ["org_cine_nadia_real_id", "org_la_taberna_real_id"] }),
        resolveOwner: spy({ name: "La Taberna de Mou", clerkId: "user_ezequiel" }),
        startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" }, canGoBack: false, sections: [] }),
    });
    await processInboundMessage(textMessage({ text: "2", from: FROM }), deps3);
    assert.deepEqual(deps3.resolveOwner.calls[0], ["org_la_taberna_real_id"]);
    assert.equal(deps3.startConversation.calls.length, 1);
    assert.deepEqual(deps3.startConversation.calls[0][0], {
        clerkId: "user_ezequiel",
        channel: "WHATSAPP",
        channelRef: FROM,
        organizationId: "org_la_taberna_real_id",
    });
    assert.equal(deps3.clearPendingSelection.calls.length, 1);
    // FASE 3K sigue normalmente: la siguiente pregunta es la primera del
    // motor real (NAME), nunca un prompt roto ni una confirmación de más.
    assert.equal(sendCalls3[0].text, "¿Cómo se llama tu evento?");
    assert.equal(sendCalls3.length, 1, "un solo mensaje de salida — nunca se manda la confirmación redundante");
});

// Selección pendiente — AWAITING_SELECTION: sólo un índice válido de la
// lista EXACTA que ya se mostró es aceptado; nunca un organizationId/nombre
// escrito a mano.
function pendingAwaitingSelection(overrides = {}) {
    return spy({
        status: "AWAITING_SELECTION",
        candidateOrganizationIds: ["org_1", "org_2", "org_3"],
        ...overrides,
    });
}

// Bug fix (confirmación redundante) — elegir un índice válido YA ES la
// confirmación explícita del organizador: persiste la elección (libera el
// pending selection) y arranca EventCreationEngine en el MISMO mensaje,
// sin mostrar nunca buildOrganizationSelectedConfirmationText ni volver a
// preguntar Sí/No.
test("pending AWAITING_SELECTION + a valid index persists the selection and starts the engine directly, without asking to confirm again", async () => {
    const { deps, sendCalls } = baseDeps({
        getPendingSelection: pendingAwaitingSelection(),
        resolveOwner: spy({ name: "Elvis Multiespacio", clerkId: "user_123" }),
    });

    await processInboundMessage(textMessage({ text: "2", from: "5491100003333" }), deps);

    assert.equal(deps.resolveOwner.calls.length, 1);
    assert.deepEqual(deps.resolveOwner.calls[0], ["org_2"]);
    assert.equal(deps.clearPendingSelection.calls.length, 1);
    assert.deepEqual(deps.clearPendingSelection.calls[0], ["5491100003333"]);
    assert.equal(deps.startConversation.calls.length, 1);
    assert.deepEqual(deps.startConversation.calls[0][0], {
        clerkId: "user_123",
        channel: "WHATSAPP",
        channelRef: "5491100003333",
        organizationId: "org_2",
    });
    // La conversación nunca arranca dos veces para una sola elección.
    assert.equal(deps.startConversation.calls.length, 1);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].text, "¿Cómo se llama tu evento?");
});

test("pending AWAITING_SELECTION + an out-of-range or non-numeric reply never resolves an organization nor starts the engine — the selector stays active", async () => {
    // "" queda afuera: shouldAutoReply ya descarta un mensaje de texto vacío
    // antes de llegar a la rama de selección pendiente (ver tests de
    // shouldAutoReply más arriba) — no es un caso de "índice inválido".
    for (const invalidReply of ["0", "4", "org_2", "hola"]) {
        const { deps, sendCalls } = baseDeps({ getPendingSelection: pendingAwaitingSelection() });

        await processInboundMessage(textMessage({ text: invalidReply }), deps);

        assert.equal(deps.resolveOwner.calls.length, 0, `no debería resolver owner para "${invalidReply}"`);
        assert.equal(deps.clearPendingSelection.calls.length, 0, `el selector debe seguir activo para "${invalidReply}"`);
        assert.equal(deps.startConversation.calls.length, 0);
        assert.equal(sendCalls[0].text, WHATSAPP_SELECTION_INVALID_TEXT);
    }
});

test("pending AWAITING_SELECTION + 'cancelar' clears the pending selection instead of treating it as an index", async () => {
    const { deps, sendCalls } = baseDeps({ getPendingSelection: pendingAwaitingSelection() });

    await processInboundMessage(textMessage({ text: "cancelar", from: "5491100003333" }), deps);

    assert.equal(deps.clearPendingSelection.calls.length, 1);
    assert.deepEqual(deps.clearPendingSelection.calls[0], ["5491100003333"]);
    assert.equal(sendCalls[0].text, WHATSAPP_CANCEL_TEXT);
});

test("pending AWAITING_SELECTION + a valid index whose organization stopped being APPROVED meanwhile is treated as not-found and cleared, without starting the engine", async () => {
    const { deps, sendCalls } = baseDeps({ getPendingSelection: pendingAwaitingSelection(), resolveOwner: spy(null) });

    await processInboundMessage(textMessage({ text: "2", from: "5491100003333" }), deps);

    assert.equal(deps.clearPendingSelection.calls.length, 1);
    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_ORGANIZATION_NOT_FOUND_TEXT);
});

// Conversación activa — sin cambios de comportamiento respecto a Fase 2E,
// salvo que ya no depende de ninguna resolución de identidad por mensaje
// (el organizationId ya viaja adentro del ConversationState, ver
// EventCreationEngine).
test("an active conversation skips discovery entirely and routes straight into handleInput", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }) });

    await processInboundMessage(textMessage({ text: "Mi evento genial" }), deps);

    assert.equal(deps.discoverCandidates.calls.length, 0);
    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0], ["conv1", { value: "Mi evento genial" }]);
    assert.equal(sendCalls[0].text, "¿De qué trata tu evento?");
});

// ==================================================
// Bug fix: reintento de índice numérico contra un step SINGLE_SELECT en
// curso. Simula el motor real: cualquier `value` que no sea el id real de
// una opción devuelve el mismo error de singleSelect.js ("Elegí una de las
// opciones que te muestro.") con las mismas `options`; sólo el id real
// avanza al siguiente step. No se modificó singleSelect.js ni
// definitions.js — el motor sigue exigiendo el id real, el adaptador de
// WhatsApp es el único que traduce el índice.
// ==================================================

function categorySingleSelectEngine() {
    return spy((_conversationId, { value }) => {
        const matched = CATEGORY_OPTIONS.find((option) => option.id === value);
        if (matched) {
            return { conversationId: "conv1", prompt: { stepId: "COVER_IMAGE", type: "QUESTION", text: "Mandame la imagen principal de tu evento." } };
        }
        return {
            conversationId: "conv1",
            prompt: {
                stepId: "CATEGORY",
                type: "QUESTION",
                inputType: "SINGLE_SELECT",
                text: "Elegí la categoría de tu evento.",
                options: CATEGORY_OPTIONS,
                error: "Elegí una de las opciones que te muestro.",
            },
        };
    });
}

test("replying '1' on an active SINGLE_SELECT step resolves to the first real option and advances the engine", async () => {
    const handleConversationInput = categorySingleSelectEngine();
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(handleConversationInput.calls.length, 2);
    assert.deepEqual(handleConversationInput.calls[0], ["conv1", { value: "1" }]);
    assert.deepEqual(handleConversationInput.calls[1], ["conv1", { value: "MUSICA" }]);
    assert.equal(sendCalls[0].text, "Mandame la imagen principal de tu evento.");
});

test("replying the last index on an active SINGLE_SELECT step resolves to the last real option", async () => {
    const handleConversationInput = categorySingleSelectEngine();
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: String(CATEGORY_OPTIONS.length) }), deps);

    assert.equal(handleConversationInput.calls.length, 2);
    assert.deepEqual(handleConversationInput.calls[1], ["conv1", { value: "DEPORTES" }]);
    assert.equal(sendCalls[0].text, "Mandame la imagen principal de tu evento.");
});

test("replying index 0 on an active SINGLE_SELECT step is rejected without a retry", async () => {
    const handleConversationInput = categorySingleSelectEngine();
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "0" }), deps);

    assert.equal(handleConversationInput.calls.length, 1, "no debería reintentar con un índice 0");
    assert.ok(sendCalls[0].text.includes("Elegí una de las opciones que te muestro."));
    assert.ok(sendCalls[0].text.includes("1. Música"));
});

test("replying an out-of-range index on an active SINGLE_SELECT step is rejected without a retry", async () => {
    const handleConversationInput = categorySingleSelectEngine();
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "99" }), deps);

    assert.equal(handleConversationInput.calls.length, 1, "no debería reintentar con un índice fuera de rango");
    assert.ok(sendCalls[0].text.includes("Elegí una de las opciones que te muestro."));
});

test("invalid free text on an active SINGLE_SELECT step never silently selects another option", async () => {
    const handleConversationInput = categorySingleSelectEngine();
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "asdkjh" }), deps);

    assert.equal(handleConversationInput.calls.length, 1);
    assert.deepEqual(handleConversationInput.calls[0], ["conv1", { value: "asdkjh" }]);
    assert.ok(sendCalls[0].text.includes("Elegí una de las opciones que te muestro."));
});

// Nota Fase 3K: TICKET_NAME dejó de ser un ejemplo válido de "step
// genérico" para este test — ahora tiene su propio texto especial en
// extractWhatsappReplyText (ver whatsapp.ticketCombo.controller.test.js).
// Se usa acá un stepId inventado, sin ningún tratamiento especial, para
// seguir probando exclusivamente la genericidad de
// resolveSingleSelectIndexReply/el mecanismo de reintento por índice.
test("the numeric-index retry works generically on a different SINGLE_SELECT step, not just CATEGORY", async () => {
    const pricingOptions = [
        { id: "FREE", label: "Gratuito" },
        { id: "PAID", label: "De pago" },
    ];
    const handleConversationInput = spy((_conversationId, { value }) => {
        if (value === "PAID") {
            return { conversationId: "conv1", prompt: { stepId: "SOME_UNSPECIALIZED_STEP", type: "QUESTION", text: "Siguiente pregunta genérica." } };
        }
        return {
            conversationId: "conv1",
            prompt: {
                stepId: "EVENT_PRICING_TYPE",
                type: "QUESTION",
                inputType: "SINGLE_SELECT",
                text: "¿Este evento es gratuito o de pago?",
                options: pricingOptions,
                error: "Elegí una de las opciones que te muestro.",
            },
        };
    });
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "2" }), deps);

    assert.equal(handleConversationInput.calls.length, 2);
    assert.deepEqual(handleConversationInput.calls[1], ["conv1", { value: "PAID" }]);
    assert.equal(sendCalls[0].text, "Siguiente pregunta genérica.");
});

test("a plain non-SINGLE_SELECT validation error (ej. SHORT_TEXT) never triggers the index-retry mechanism", async () => {
    const handleConversationInput = spy({
        conversationId: "conv1",
        prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?", error: "Contame un poco más, no puede quedar vacío." },
    });
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }), handleConversationInput });

    await processInboundMessage(textMessage({ text: "1" }), deps);

    assert.equal(handleConversationInput.calls.length, 1);
    assert.ok(sendCalls[0].text.includes("Contame un poco más"));
});

test("'Sí' with an active conversation is treated as plain input, never re-triggers start", async () => {
    const { deps } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }) });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(deps.handleConversationInput.calls.length, 1);
    assert.deepEqual(deps.handleConversationInput.calls[0][1], { value: "Sí" });
});

test("'cancelar' with an active conversation calls EventCreationEngine.cancel and confirms it", async () => {
    const { deps, sendCalls } = baseDeps({ findActiveConversation: spy({ id: "conv1", userId: "user_123", organizationId: "org_1" }) });

    await processInboundMessage(textMessage({ text: "cancelar" }), deps);

    assert.equal(deps.cancelConversation.calls.length, 1);
    assert.deepEqual(deps.cancelConversation.calls[0], ["conv1", "user_123"]);
    assert.equal(deps.handleConversationInput.calls.length, 0);
    assert.equal(sendCalls[0].text, WHATSAPP_CANCEL_TEXT);
});

// Ningún error (motor, discovery, lookup) escapa de processInboundMessage —
// el webhook debe seguir devolviendo 200 siempre.
test("an EventCreationEngine or discovery failure never throws out of processInboundMessage", async () => {
    const { deps: depsStartThrows } = baseDeps({ startConversation: spy(new Error("engine boom")) });
    await assert.doesNotReject(() => processInboundMessage(textMessage({ text: "Sí" }), depsStartThrows));

    const { deps: depsLookupThrows } = baseDeps({ findActiveConversation: spy(new Error("db unavailable")) });
    await assert.doesNotReject(() => processInboundMessage(textMessage({ text: "hola" }), depsLookupThrows));

    const { deps: depsDiscoveryThrows } = baseDeps({ discoverCandidates: spy(new Error("db unavailable")) });
    await assert.doesNotReject(() => processInboundMessage(textMessage({ text: "hola" }), depsDiscoveryThrows));
});

// Dos mensajes de WhatsApp en el mismo payload se procesan de forma
// independiente y controlada.
test("two inbound messages in the same payload are processed independently, each starting its own conversation", async () => {
    const { sendText, calls: sendCalls } = fakeSender();
    const deps = {
        sendText,
        findActiveConversation: spy(null),
        startConversation: spy({ conversationId: "conv1", prompt: { stepId: "NAME", type: "QUESTION", text: "¿Cómo se llama tu evento?" } }),
        handleConversationInput: spy(null),
        cancelConversation: spy(undefined),
        discoverCandidates: spy([{ organizationId: "org_1", name: "Elvis Bar", clerkId: "user_123" }]),
        getPendingSelection: spy(null),
        getOrganizationPlanForWhatsapp: spy({ plan: "PREMIUM" }),
    };
    const messages = [
        textMessage({ messageId: "wamid.IN1", from: "5491100000001", text: "Sí" }),
        textMessage({ messageId: "wamid.IN2", from: "5491100000002", text: "Sí" }),
    ];

    await processInboundMessages(messages, deps);

    assert.equal(deps.startConversation.calls.length, 2);
    assert.deepEqual(
        deps.startConversation.calls.map((call) => call[0].channelRef).sort(),
        ["5491100000001", "5491100000002"]
    );
    assert.equal(sendCalls.length, 2);
});

// Mensajes no-text no entran al motor.
test("a non-text message never reaches the engine", async () => {
    const { deps, sendCalls } = baseDeps();

    await processInboundMessage(textMessage({ type: "image", text: null }), deps);

    assert.equal(deps.findActiveConversation.calls.length, 0);
    assert.equal(deps.discoverCandidates.calls.length, 0);
    assert.equal(deps.startConversation.calls.length, 0);
    assert.equal(sendCalls.length, 0);
});

// Fase 2F, legacy: confirma explícitamente que ya no forma parte del árbol
// de decisión — pasar esos mocks (que tirarían si se llamaran) no rompe
// nada porque processInboundMessage ya ni siquiera los desestructura.
test("Fase 2F's link-challenge flow is never triggered from the new WhatsApp Organizer decision tree", async () => {
    const throwIfCalled = async () => {
        throw new Error("no debería llamarse: el flujo de challenge/código de 6 dígitos es legacy desde Fase 2G");
    };
    const { deps, sendCalls } = baseDeps({
        resolveOrganizerIdentity: throwIfCalled,
        createLinkChallenge: throwIfCalled,
    });

    await processInboundMessage(textMessage({ text: "Sí" }), deps);

    assert.equal(deps.startConversation.calls.length, 1);
    assert.equal(sendCalls[0].text, "¿Cómo se llama tu evento?");
});

// Cobertura adicional de Fase 2D.1 que sigue vigente: el destinatario de
// salida (`to`) se normaliza sólo con WHATSAPP_TEST_MODE=true, pero
// channelRef (con qué conversación arranca/sigue el motor, y con qué wa_id
// se busca la Organization) usa siempre el wa_id crudo, nunca el normalizado.
test("outbound recipient normalization (WHATSAPP_TEST_MODE) never affects which conversation/channelRef is used", async () => {
    const previousTestMode = process.env.WHATSAPP_TEST_MODE;
    process.env.WHATSAPP_TEST_MODE = "true";

    const { deps, sendCalls } = baseDeps();

    try {
        await processInboundMessage(textMessage({ text: "Sí", from: "5492984405532" }), deps);
    } finally {
        if (previousTestMode === undefined) delete process.env.WHATSAPP_TEST_MODE;
        else process.env.WHATSAPP_TEST_MODE = previousTestMode;
    }

    assert.equal(deps.startConversation.calls[0][0].channelRef, "5492984405532");
    assert.equal(deps.discoverCandidates.calls[0][0], "5492984405532");
    assert.equal(sendCalls[0].to, "542984405532");
});
