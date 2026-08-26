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
// el motor real EXACTAMENTE en EVENT_PRICING_TYPE, sin mockear nada.
// title/location/functions no hacen falta acá: este test nunca llega a
// PREVIEW/commit (eso ya lo cubre eventAdmissionType.test.js, tests E/F) —
// sólo verifica que handleInput() escriba admissionType/ticketTypes
// correctamente en el draft persistido, que es justamente lo que cambió
// esta ronda en steps/definitions.js.
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

testWithDb("motor real: 'gratis' + 'sin control de acceso' persiste admissionType=FREE_ENTRY, ticketTypes=[], sin fantasma", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_PRICING_TYPE", history: ["EVENT_PRICING_TYPE"] });
    try {
        const afterPricing = await EventCreationEngine.handleInput(conv.id, { value: "FREE" });
        assert.equal(afterPricing.prompt.stepId, "WANTS_FREE_TICKETS", "debe pasar a preguntar por el control de acceso");

        const afterWants = await EventCreationEngine.handleInput(conv.id, { value: false });
        assert.equal(afterWants.prompt.stepId, "PROMO_VIDEO_ASK", "sin control de acceso, se salta directo a video promocional — nunca pasa por TICKET_NAME/FREE_TICKET_QUANTITY");

        const persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "FREE_ENTRY");
        assert.deepEqual(persisted.draftEvent.ticketTypes, [], "cero TicketTypes en el draft — nunca el fantasma 'Entrada general'");
        assert.equal(persisted.draftEvent.hasTickets, false);
    } finally {
        await deleteConversationState(conv.id);
    }
});

testWithDb("motor real: 'gratis' + 'con control de acceso' sigue siendo admissionType=TICKETED con una entrada real a $0", async () => {
    const conv = await createConversationState({ currentStepId: "EVENT_PRICING_TYPE", history: ["EVENT_PRICING_TYPE"] });
    try {
        await EventCreationEngine.handleInput(conv.id, { value: "FREE" });

        const afterWants = await EventCreationEngine.handleInput(conv.id, { value: true });
        assert.equal(afterWants.prompt.stepId, "FREE_TICKET_QUANTITY", "con control de acceso, pasa a pedir la cantidad de entradas gratuitas");

        let persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "TICKETED", "TICKETED se fija apenas contesta que sí, antes incluso de cargar la cantidad");

        const afterQuantity = await EventCreationEngine.handleInput(conv.id, { value: "300" });
        assert.equal(afterQuantity.prompt.stepId, "PROMO_VIDEO_ASK");

        persisted = await prisma.conversationState.findUnique({ where: { id: conv.id } });
        assert.equal(persisted.draftEvent.admissionType, "TICKETED");
        assert.equal(persisted.draftEvent.ticketTypes.length, 1);
        assert.equal(persisted.draftEvent.ticketTypes[0].name, "Entrada gratuita");
        assert.equal(Number(persisted.draftEvent.ticketTypes[0].price), 0);
        assert.equal(Number(persisted.draftEvent.ticketTypes[0].quantity), 300);
    } finally {
        await deleteConversationState(conv.id);
    }
});
