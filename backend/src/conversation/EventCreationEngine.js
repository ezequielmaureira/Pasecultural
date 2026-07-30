import prisma from "../config/prisma.js";
import { FIRST_STEP_ID, PREVIEW_STEP_ID, getStep } from "./steps/definitions.js";
import { getInputHandler } from "./inputHandlers/index.js";
import * as EventServicePort from "./EventServicePort.js";

// Orquestador único del flujo conversacional de creación de eventos.
// No conoce Express, Twilio, ni Prisma más allá de leer/escribir su propio
// ConversationState: Web y WhatsApp son sólo "clientes" de start/handleInput/resume.
// clerkId es la identidad ya resuelta por el ChannelAdapter del canal (en Web,
// la sesión Clerk; en WhatsApp, el número verificado contra la Organization).

// `currentValueOverride` es lo que permite que "Volver" muestre el último
// valor CONFIRMADO para ese paso (ver handleBack): si no se pasa, se usa
// `step.getCurrentValue` (derivado del draft — para cuando se entra al paso
// por el flujo normal o por "Editar" desde el preview, no por un Volver).
function buildPrompt(stepId, draft, loopStack, currentValueOverride) {
    if (stepId === PREVIEW_STEP_ID) {
        return { stepId, type: "PREVIEW", draft };
    }
    const step = getStep(stepId);
    // Se reenvía cada campo que devuelva el step, no sólo text/options:
    // algunos pasos (ej. FUNCTIONS_LIST) necesitan mandar
    // datos extra (la lista de funciones armada hasta el momento) sin que el
    // motor tenga que conocer esos campos.
    const { text, ...extra } = step.buildPrompt(draft, loopStack);
    let currentValue = currentValueOverride;
    if (currentValue === undefined && step.getCurrentValue) {
        currentValue = step.getCurrentValue(draft, loopStack);
    }
    return { stepId, type: "QUESTION", text, inputType: step.inputType, currentValue, ...extra };
}

function toConversationResult(state, currentValueOverride) {
    return {
        conversationId: state.id,
        prompt: buildPrompt(state.currentStepId, state.draftEvent, state.loopStack, currentValueOverride),
        canGoBack: state.history.length > 0,
    };
}

function appendHistory(history, entry) {
    return [...history, { ...entry, at: new Date().toISOString() }];
}

export async function start({ clerkId, channel, channelRef }) {
    const state = await prisma.conversationState.create({
        data: {
            userId: clerkId ?? null,
            channel,
            channelRef,
            currentStepId: FIRST_STEP_ID,
            loopStack: [],
            draftEvent: {},
            history: [],
            status: "ACTIVE",
        },
    });

    return toConversationResult(state);
}

async function loadActiveConversation(conversationId) {
    const state = await prisma.conversationState.findUnique({ where: { id: conversationId } });
    if (!state) {
        throw new Error("CONVERSATION_NOT_FOUND");
    }
    if (state.status !== "ACTIVE") {
        throw new Error("CONVERSATION_CLOSED");
    }
    return state;
}

// "Descartar borrador": borra la fila entera en vez de marcarla con un
// status nuevo (ej. CANCELLED) para no tocar el enum ConversationStatus ni
// pedir una migración de Prisma por esto.
export async function cancel(conversationId, clerkId) {
    const state = await prisma.conversationState.findUnique({ where: { id: conversationId } });
    if (!state) {
        throw new Error("CONVERSATION_NOT_FOUND");
    }
    if (state.userId && state.userId !== clerkId) {
        throw new Error("CONVERSATION_FORBIDDEN");
    }
    await prisma.conversationState.delete({ where: { id: conversationId } });
}

export async function resume(conversationId) {
    const state = await prisma.conversationState.findUnique({ where: { id: conversationId } });
    if (!state) {
        throw new Error("CONVERSATION_NOT_FOUND");
    }
    try {
        return toConversationResult(state);
    } catch (error) {
        // Conversación vieja parada en un stepId que ya no existe (ej.
        // después de renombrar/quitar pasos del motor, como el rediseño de
        // Funciones). No hay forma de retomarla: se trata como si no
        // existiera para que el cliente arranque una nueva.
        if (error.message?.startsWith("UNKNOWN_STEP")) {
            throw new Error("CONVERSATION_NOT_FOUND");
        }
        throw error;
    }
}

async function handlePreviewInput(state, rawInput) {
    const action = rawInput?.action;

    if (action === "EDIT") {
        const targetStepId = rawInput.stepId;
        const targetStep = getStep(targetStepId); // valida que exista, tira UNKNOWN_STEP si no
        // Campos sueltos (ej. la imagen) marcados `editReturnsToPreview`: se
        // apila un marcador para que, al responder esa única pregunta, el
        // motor vuelva directo a PREVIEW en vez de seguir la cadena normal
        // (ej. COVER_IMAGE -> LOCATION -> ...), sin tener que repetir el
        // resto de los datos ya cargados.
        const nextLoopStack = targetStep.editReturnsToPreview
            ? [...state.loopStack, { __editReturnTo: PREVIEW_STEP_ID }]
            : state.loopStack;
        const updated = await prisma.conversationState.update({
            where: { id: state.id },
            data: { currentStepId: targetStepId, loopStack: nextLoopStack },
        });
        return toConversationResult(updated);
    }

    if (action !== "PUBLISH" && action !== "DRAFT") {
        return {
            conversationId: state.id,
            prompt: {
                stepId: PREVIEW_STEP_ID,
                type: "PREVIEW",
                draft: state.draftEvent,
                error: 'Elegí "PUBLISH", "DRAFT" o "EDIT".',
            },
            canGoBack: state.history.length > 0,
        };
    }

    try {
        const event = await EventServicePort.commit(state.userId, state.draftEvent, action);
        const updated = await prisma.conversationState.update({
            where: { id: state.id },
            data: {
                status: action === "PUBLISH" ? "PUBLISHED" : "DRAFT_SAVED",
                eventId: event.id,
                history: appendHistory(state.history, { stepId: PREVIEW_STEP_ID, action }),
            },
        });
        return {
            conversationId: updated.id,
            done: true,
            status: updated.status,
            event,
        };
    } catch (error) {
        return {
            conversationId: state.id,
            prompt: {
                stepId: PREVIEW_STEP_ID,
                type: "PREVIEW",
                draft: state.draftEvent,
                error: error.isConversational ? error.message : "No pudimos guardar el evento, intentá de nuevo.",
            },
            canGoBack: state.history.length > 0,
        };
    }
}

// Cada entrada de historial guarda una foto de draftEvent/loopStack tal como
// estaban ANTES de aplicar esa respuesta. "Volver atrás" es simplemente
// desapilar la última entrada y restaurar esa foto — funciona igual en medio
// de un loop (funciones/entradas/redes) porque la foto ya captura en qué
// iteración del loop estaba el usuario antes de responder.
async function handleBack(state) {
    if (state.history.length === 0) {
        return {
            conversationId: state.id,
            prompt: {
                ...buildPrompt(state.currentStepId, state.draftEvent, state.loopStack),
                error: "Ya estás en la primera pregunta.",
            },
            canGoBack: false,
        };
    }

    const previousHistory = state.history.slice(0, -1);
    const lastEntry = state.history[state.history.length - 1];

    const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
            currentStepId: lastEntry.stepId,
            draftEvent: lastEntry.draftBefore,
            loopStack: lastEntry.loopStackBefore,
            history: previousHistory,
        },
    });

    // `lastEntry.value` es exactamente lo que el usuario había confirmado la
    // última vez para este paso (fue guardado tal cual al responderlo, ver
    // handleInput más abajo) — reenviarlo como currentValue es lo que le
    // permite al frontend precargar la respuesta anterior en vez de mostrar
    // el paso en blanco, sea cual sea su tipo (texto, imagen, ubicación,
    // tarjeta de función, rango de fechas, etc.).
    return toConversationResult(updated, lastEntry.value);
}

export async function handleInput(conversationId, rawInput) {
    const state = await loadActiveConversation(conversationId);

    if (rawInput?.action === "BACK") {
        return handleBack(state);
    }

    if (state.currentStepId === PREVIEW_STEP_ID) {
        return handlePreviewInput(state, rawInput);
    }

    const step = getStep(state.currentStepId);
    const handler = getInputHandler(step.inputType);
    const { value, error } = handler.parse(rawInput?.value, {
        draft: state.draftEvent,
        loopStack: state.loopStack,
        options: buildPrompt(state.currentStepId, state.draftEvent, state.loopStack).options,
    });

    if (error) {
        return {
            conversationId: state.id,
            prompt: { ...buildPrompt(state.currentStepId, state.draftEvent, state.loopStack), error },
            canGoBack: state.history.length > 0,
        };
    }

    const { draft, loopStack } = step.apply(state.draftEvent, state.loopStack, value);

    // Si este paso se respondió como una edición puntual desde el preview
    // (ver handlePreviewInput), el marcador apilado gana por sobre el
    // encadenamiento normal de `step.next` y se vuelve directo a PREVIEW.
    const editMarker = loopStack[loopStack.length - 1];
    const isEditReturn = Boolean(editMarker?.__editReturnTo);
    const nextStepId = isEditReturn ? editMarker.__editReturnTo : step.next(draft, loopStack, value);
    const finalLoopStack = isEditReturn ? loopStack.slice(0, -1) : loopStack;

    const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
            currentStepId: nextStepId,
            draftEvent: draft,
            loopStack: finalLoopStack,
            history: appendHistory(state.history, {
                stepId: step.id,
                value,
                draftBefore: state.draftEvent,
                loopStackBefore: state.loopStack,
            }),
        },
    });

    return toConversationResult(updated);
}
