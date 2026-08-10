import prisma from "../config/prisma.js";
import { FIRST_STEP_ID, PREVIEW_STEP_ID, getStep } from "./steps/definitions.js";
import { SECTIONS } from "./steps/sections.js";
import { getInputHandler } from "./inputHandlers/index.js";
import * as EventServicePort from "./EventServicePort.js";

// Orquestador único del flujo conversacional de creación de eventos.
// No conoce Express, Twilio, ni Prisma más allá de leer/escribir su propio
// ConversationState: Web y WhatsApp son sólo "clientes" de start/handleInput/resume.
// clerkId es la identidad ya resuelta por el ChannelAdapter del canal (en Web,
// la sesión Clerk; en WhatsApp, el número verificado contra la Organization).
//
// El estado del evento entero vive en un único lugar: `draftEvent` (JSON).
// No hay ninguna pila auxiliar — cada StepDefinition (steps/definitions.js)
// cumple el mismo contrato (getValue/setValue/next, todos función pura de
// draft) y el motor nunca necesita saber qué tipo de paso es para navegar.
// Eso es lo que hace que Volver, saltar a una sección y "Editar" desde el
// preview sean, en el fondo, la misma operación: mover `currentStepId` sin
// tocar `draftEvent`.

// `_key` (identidad interna de un ítem de lista, ver steps/definitions.js)
// y cualquier campo de borrador en curso (prefijo "_", ej. `_ticketDraft`)
// son bookkeeping del motor — nunca deben cruzar hacia el frontend ni hacia
// la persistencia final del evento.
function stripItemKeys(list) {
    return (list ?? []).map(({ _key, ...rest }) => rest);
}

function toPreviewDraft(draft) {
    const visible = Object.fromEntries(Object.entries(draft).filter(([key]) => !key.startsWith("_")));
    return {
        ...visible,
        ticketTypes: stripItemKeys(visible.ticketTypes),
        socialLinks: stripItemKeys(visible.socialLinks),
    };
}

// `currentValueOverride` existe sólo para el mensaje de error "Ya estás en
// la primera pregunta" (necesita re-mostrar el prompt actual tal cual). En
// cualquier otro caso el valor a precargar es siempre `step.getValue(draft)`
// — no hace falta distinguir si se llegó por flujo normal, Volver, GOTO o
// edición desde el preview: todas dejan el draft intacto salvo por lo que el
// usuario efectivamente confirmó.
function buildPrompt(stepId, draft) {
    if (stepId === PREVIEW_STEP_ID) {
        return { stepId, type: "PREVIEW", draft: toPreviewDraft(draft) };
    }
    const step = getStep(stepId);
    // Se reenvía cada campo que devuelva el step, no sólo text/options:
    // algunos pasos (ej. FUNCTIONS_LIST) necesitan mandar datos extra (la
    // lista de funciones armada hasta el momento) sin que el motor tenga
    // que conocer esos campos.
    const { text, ...extra } = step.buildPrompt(draft);
    return { stepId, type: "QUESTION", text, inputType: step.inputType, currentValue: step.getValue(draft), ...extra };
}

// Deriva el estado de cada sección (steps/sections.js) exclusivamente a
// partir de `history` (qué stepIds se visitaron) y `currentStepId` — nunca
// mira de qué trata cada paso, así que agregar una sección nueva (ej.
// "Patrocinadores") no requiere tocar esta función.
//
// Cada sección se evalúa de forma independiente, por evidencia directa (¿se
// visitó alguno de sus propios steps?) y no por posición en el array: el
// orden de SECTIONS es el orden de *visualización* que pidió el organizador
// (ej. "Fecha y hora" antes que "Ubicación"), que no necesariamente coincide
// con el orden real en que el motor recorre los pasos (ej. la imagen se
// pregunta antes que la ubicación). Inferir "completada" a partir de la
// posición en el array asumiría que ambos órdenes coinciden, y no es así.
//
//  - "current" si el paso en el que está parado el usuario pertenece a ella.
//  - "completed" si se visitó alguno de sus pasos en algún momento (todavía
//    no distingue "completa" de "empezada pero incompleta" — eso queda para
//    cuando se agregue validación de errores/campos faltantes, más adelante).
//  - "pending" si nunca se visitó — y por lo tanto no navegable: el
//    navegador de secciones no debe ofrecer saltar a algo que todavía no se
//    alcanzó.
function computeSectionStatuses(draftEvent, currentStepId, history) {
    const currentSectionId =
        currentStepId === PREVIEW_STEP_ID
            ? "PUBLICACION"
            : SECTIONS.find((section) => section.steps.includes(currentStepId))?.id;

    const visited = new Set(history);

    return SECTIONS.map((section) => {
        const reached =
            section.id === "PUBLICACION" ? visited.has(PREVIEW_STEP_ID) : section.steps.some((id) => visited.has(id));

        let status = "pending";
        if (section.id === currentSectionId) status = "current";
        else if (reached) status = "completed";

        return {
            id: section.id,
            label: section.label,
            status,
            // A dónde saltar si se hace click: el primer paso de la sección,
            // salvo "Publicación" que no es un StepDefinition sino el estado
            // especial PREVIEW.
            targetStepId: section.id === "PUBLICACION" ? PREVIEW_STEP_ID : section.steps[0],
        };
    });
}

function toConversationResult(state) {
    return {
        conversationId: state.id,
        prompt: buildPrompt(state.currentStepId, state.draftEvent),
        canGoBack: state.history.length > 1,
        sections: computeSectionStatuses(state.draftEvent, state.currentStepId, state.history),
    };
}

// El history es sólo el camino de stepIds visitados, en orden — no guarda
// snapshots de datos (no hace falta: draftEvent nunca se revierte, es
// siempre la única fuente de verdad). Sirve para que "Volver" sepa a qué
// paso ir; GOTO simplemente lo extiende con el destino, igual que el botón
// atrás del navegador registra una página nueva al entrar por un link.
function appendHistory(history, stepId) {
    return [...history, stepId];
}

export async function start({ clerkId, channel, channelRef }) {
    const state = await prisma.conversationState.create({
        data: {
            userId: clerkId ?? null,
            channel,
            channelRef,
            currentStepId: FIRST_STEP_ID,
            draftEvent: {},
            history: [FIRST_STEP_ID],
            status: "ACTIVE",
        },
    });

    return toConversationResult(state);
}

// Único lookup adicional que necesita un canal sin conversationId
// persistido del lado del cliente — Web siempre tiene el conversationId que
// le devolvió start() (lo guarda el frontend); WhatsApp es stateless entre
// mensajes, así que no hay otro identificador estable más que channel +
// channelRef (Fase 2E). Reutiliza exactamente las mismas columnas que ya
// escribe start(), no agrega ningún estado ni modelo nuevo.
export async function findActiveConversation({ channel, channelRef }) {
    const state = await prisma.conversationState.findFirst({
        where: { channel, channelRef, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        select: { id: true, userId: true },
    });
    return state ? { id: state.id, userId: state.userId } : null;
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

// Consulta liviana de "¿qué pasó realmente con esto?", pensada para el caso
// en que el cliente sufrió un timeout esperando la respuesta de /reply (ver
// ConversationView.jsx): el fetch se cae por las suyas, pero el commit
// puede haber terminado igual del lado del servidor. No arma ningún prompt
// ni toca nada — sólo expone el status/eventId ya persistidos para que el
// frontend pueda confirmar el resultado real en vez de asumir que falló.
export async function getStatus(conversationId) {
    const state = await prisma.conversationState.findUnique({
        where: { id: conversationId },
        select: { status: true, eventId: true },
    });
    if (!state) {
        throw new Error("CONVERSATION_NOT_FOUND");
    }
    return state;
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

// Único mecanismo de salto: mueve el cursor a cualquier stepId sin tocar
// draftEvent. Lo usan tanto "Editar" desde el preview como (a futuro) el
// navegador de secciones — ambos son, en el fondo, "quiero ver/corregir
// este paso" sin perder nada de lo que ya está confirmado más adelante.
//
// Si el paso destino está marcado `editReturnsToPreview`, se guarda un
// recordatorio (`draft._returnTo`) para que, apenas se responda esa única
// pregunta, el motor vuelva derecho a PREVIEW en vez de seguir la cadena
// normal (ej. COVER_IMAGE -> LOCATION -> ...) — sin este marcador, editar la
// foto desde el resumen obligaría a repasar el resto del evento.
async function handleGoto(state, targetStepId) {
    const targetStep = getStep(targetStepId); // valida que exista, tira UNKNOWN_STEP si no
    const draft = targetStep.editReturnsToPreview
        ? { ...state.draftEvent, _returnTo: PREVIEW_STEP_ID }
        : state.draftEvent;

    const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
            currentStepId: targetStepId,
            draftEvent: draft,
            history: appendHistory(state.history, targetStepId),
        },
    });

    return toConversationResult(updated);
}

// "Volver" es GOTO al paso anterior en el camino ya recorrido — nunca
// revierte draftEvent. Si lo hiciera, al avanzar de nuevo el motor volvería
// a generar cada paso siguiente con valores vacíos, aunque el evento ya los
// tuviera cargados (el bug que este diseño evita de raíz: el estado del
// evento sólo cambia cuando el usuario *responde* un paso, nunca por el
// solo hecho de mirar uno anterior).
async function handleBack(state) {
    if (state.history.length <= 1) {
        return {
            conversationId: state.id,
            prompt: {
                ...buildPrompt(state.currentStepId, state.draftEvent),
                error: "Ya estás en la primera pregunta.",
            },
            canGoBack: false,
            sections: computeSectionStatuses(state.draftEvent, state.currentStepId, state.history),
        };
    }

    const previousHistory = state.history.slice(0, -1);
    const targetStepId = previousHistory[previousHistory.length - 1];

    const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: { currentStepId: targetStepId, history: previousHistory },
    });

    return toConversationResult(updated);
}

async function handlePreviewInput(state, rawInput) {
    const action = rawInput?.action;

    if (action === "EDIT" || action === "GOTO") {
        return handleGoto(state, rawInput.stepId);
    }

    if (action !== "PUBLISH" && action !== "DRAFT") {
        return {
            conversationId: state.id,
            prompt: {
                stepId: PREVIEW_STEP_ID,
                type: "PREVIEW",
                draft: toPreviewDraft(state.draftEvent),
                error: 'Elegí "PUBLISH", "DRAFT" o "EDIT".',
            },
            canGoBack: state.history.length > 1,
            sections: computeSectionStatuses(state.draftEvent, state.currentStepId, state.history),
        };
    }

    try {
        const event = await EventServicePort.commit(state.userId, state.draftEvent, action);
        const updated = await prisma.conversationState.update({
            where: { id: state.id },
            data: {
                status: action === "PUBLISH" ? "PUBLISHED" : "DRAFT_SAVED",
                eventId: event.id,
                history: appendHistory(state.history, PREVIEW_STEP_ID),
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
                draft: toPreviewDraft(state.draftEvent),
                error: error.isConversational ? error.message : "No pudimos guardar el evento, intentá de nuevo.",
            },
            canGoBack: state.history.length > 1,
            sections: computeSectionStatuses(state.draftEvent, state.currentStepId, state.history),
        };
    }
}

export async function handleInput(conversationId, rawInput) {
    const state = await loadActiveConversation(conversationId);

    if (rawInput?.action === "BACK") {
        return handleBack(state);
    }

    if (state.currentStepId === PREVIEW_STEP_ID) {
        return handlePreviewInput(state, rawInput);
    }

    if (rawInput?.action === "GOTO") {
        return handleGoto(state, rawInput.stepId);
    }

    const step = getStep(state.currentStepId);
    const handler = getInputHandler(step.inputType);
    const { value, error } = handler.parse(rawInput?.value, {
        draft: state.draftEvent,
        options: buildPrompt(state.currentStepId, state.draftEvent).options,
    });

    if (error) {
        return {
            conversationId: state.id,
            prompt: { ...buildPrompt(state.currentStepId, state.draftEvent), error },
            canGoBack: state.history.length > 1,
            sections: computeSectionStatuses(state.draftEvent, state.currentStepId, state.history),
        };
    }

    let draft = step.setValue(state.draftEvent, value);

    // Si se llegó a este paso editando puntualmente desde el preview (ver
    // handleGoto), el recordatorio gana por sobre el encadenamiento normal
    // de `step.next` y se vuelve directo a PREVIEW.
    const returnTo = draft._returnTo;
    let nextStepId;
    if (returnTo) {
        const { _returnTo, ...rest } = draft;
        draft = rest;
        nextStepId = returnTo;
    } else {
        nextStepId = step.next(draft, value);
    }

    const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
            currentStepId: nextStepId,
            draftEvent: draft,
            history: appendHistory(state.history, nextStepId),
        },
    });

    return toConversationResult(updated);
}
