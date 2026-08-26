import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import * as EventCreationEngine from "../src/conversation/EventCreationEngine.js";

// Eventos gratuitos (FREE_ENTRY) — a diferencia de eventAdmissionType.test.js
// (que arma el draft equivalente a mano y llama EventServicePort.commit
// directo), este archivo ejercita el motor conversacional REAL turno por
// turno (EventCreationEngine.handleInput), exactamente el mismo camino que
// recorre un organizador de verdad tanto en el chat web como en WhatsApp
// (ambos comparten este mismo módulo — ver whatsapp.controller.js y
// conversation.controller.js, los dos importan
// "../conversation/EventCreationEngine.js" sin ninguna bifurcación).
//
// No hace falta caminar las ~14 preguntas desde NAME: ConversationState es
// una fila de Postgres común (Prisma), así que el mismo patrón de
// `createConversationState({ currentStepId: ... })` que ya usa
// eventCreationEngine.conversationStateCache.test.js alcanza para arrancar
// el motor real EXACTAMENTE en el paso que interesa, sin mockear nada.
// title/location/functions no hacen falta acá: este archivo nunca llega a
// PREVIEW/commit (eso ya lo cubre eventAdmissionType.test.js, tests E/F).
//
// Corrección post-deploy (decisión de producto definitiva) — "Gratuito" ya
// no pregunta por control de acceso: es FREE_ENTRY de una sola vez, sin
// pasar por WANTS_FREE_TICKETS/FREE_TICKET_QUANTITY (ver el comentario en
// steps/definitions.js#EVENT_PRICING_TYPE). Esos dos pasos NO se borraron —
// siguen intactos en el motor, alcanzables únicamente por una
// ConversationState vieja que ya hubiera quedado parada ahí antes de este
// fix (compatibilidad transitoria) — de ahí los dos tests de compatibilidad
// al final de este archivo, que arrancan sembrando el estado directamente
// en WANTS_FREE_TICKETS para simular exactamente ese escenario.
//
// Guardrail centralizado — ver tests/helpers/dbGuard.js.
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
// A) Camino nuevo — "Gratuito" produce FREE_ENTRY de una sola vez, sin
// preguntar nada de control de acceso ni de ticketing.
// ==================================================================

testWithDb("A) motor real: EVENT_PRICING_TYPE + 'Gratuito' produce FREE_ENTRY de inmediato, sin pasar por WANTS_FREE_TICKETS ni ningún paso de ticketing", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_PRICING_TYPE", history: ["EVENT_PRICING_TYPE"] });
    try {
        const afterPricing = await EventCreationEngine.handleInput(conv.id, { value: "FREE" });
        assert.equal(afterPricing.prompt.stepId, "PROMO_VIDEO_ASK", "un solo turno alcanza: salta directo a video promocional");
        assert.notEqual(afterPricing.prompt.stepId, "WANTS_FREE_TICKETS");
        assert.notEqual(afterPricing.prompt.stepId, "FREE_TICKET_QUANTITY");
        assert.notEqual(afterPricing.prompt.stepId, "TICKET_NAME");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "FREE_ENTRY");
        assert.deepEqual(persisted.draftEvent.ticketTypes, [], "cero TicketTypes en el draft — nunca el fantasma 'Entrada general', nunca ninguna otra entrada");
        assert.equal(persisted.draftEvent.hasTickets, false);
        assert.equal(persisted.history.includes("WANTS_FREE_TICKETS"), false, "WANTS_FREE_TICKETS no debe aparecer en el historial de una conversación arrancada después de este fix");
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// B) TICKETED (pago) — sigue el flujo de catálogo normal, sin cambios.
// ==================================================================

testWithDb("B) motor real: EVENT_PRICING_TYPE + 'De pago' produce admissionType=TICKETED y sigue el flujo de catálogo de siempre", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_PRICING_TYPE", history: ["EVENT_PRICING_TYPE"] });
    try {
        const afterPricing = await EventCreationEngine.handleInput(conv.id, { value: "PAID" });
        assert.equal(afterPricing.prompt.stepId, "TICKET_NAME", "sin cambios: sigue yendo directo al catálogo de tipos de entrada");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");
        assert.equal(persisted.draftEvent.hasTickets, true);
    } finally {
        await deleteConversationState(conv.id);
    }
});

// ==================================================================
// D) Compatibilidad transitoria — una ConversationState que YA estaba
// parada en WANTS_FREE_TICKETS (creada en producción antes de este fix)
// tiene que poder seguir respondiendo exactamente igual que antes: sin
// crash, sin loop, sin estado imposible. Cubre las dos respuestas
// posibles de ese paso viejo.
// ==================================================================

testWithDb("D1) compatibilidad: una ConversationState vieja parada en WANTS_FREE_TICKETS respondiendo 'Sí' sigue funcionando exactamente igual que antes (TICKETED + entrada real a $0)", async () => {
    const conv = await createConversationState({
        currentStepId: "WANTS_FREE_TICKETS",
        draftEvent: { pricingType: "FREE", hasTickets: false, ticketTypes: [] },
        history: ["EVENT_PRICING_TYPE", "WANTS_FREE_TICKETS"],
    });
    try {
        const afterWants = await EventCreationEngine.handleInput(conv.id, { value: true });
        assert.equal(afterWants.prompt.stepId, "FREE_TICKET_QUANTITY", "el paso sigue intacto, nunca UNKNOWN_STEP ni ningún otro error");

        let persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");

        const afterQuantity = await EventCreationEngine.handleInput(conv.id, { value: "50" });
        assert.equal(afterQuantity.prompt.stepId, "PROMO_VIDEO_ASK");

        persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");
        assert.equal(persisted.draftEvent.ticketTypes.length, 1);
        assert.equal(persisted.draftEvent.ticketTypes[0].name, "Entrada gratuita");
        assert.equal(Number(persisted.draftEvent.ticketTypes[0].price), 0);
        assert.equal(Number(persisted.draftEvent.ticketTypes[0].quantity), 50);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("D2) compatibilidad: una ConversationState vieja parada en WANTS_FREE_TICKETS respondiendo 'No' sigue terminando en FREE_ENTRY, igual que antes", async () => {
    const conv = await createConversationState({
        currentStepId: "WANTS_FREE_TICKETS",
        draftEvent: { pricingType: "FREE", hasTickets: false, ticketTypes: [] },
        history: ["EVENT_PRICING_TYPE", "WANTS_FREE_TICKETS"],
    });
    try {
        const afterWants = await EventCreationEngine.handleInput(conv.id, { value: false });
        assert.equal(afterWants.prompt.stepId, "PROMO_VIDEO_ASK");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "FREE_ENTRY");
        assert.deepEqual(persisted.draftEvent.ticketTypes, []);
    } finally {
        await deleteConversationState(conv.id);
    }
});
