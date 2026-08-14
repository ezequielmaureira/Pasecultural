// Fase 4 (optimización de latencia, PASO 1 del pedido) — cache de
// ConversationState ACOTADA a un único mensaje de WhatsApp. Mismo patrón que
// utils/whatsappPerf.js (activeTimerStorage/enterWithActiveTimer):
// AsyncLocalStorage, NUNCA una Map global compartida entre requests — cada
// mensaje entra a su propio contexto asíncrono (ver
// enterWithConversationStateRequestCache, llamado una vez por mensaje en
// processInboundMessage, igual que enterWithActiveTimer), así que:
//
//  - Dos mensajes procesados "en paralelo" (Promise.allSettled en
//    processInboundMessages) nunca leen ni pisan la copia del otro — cada
//    `await` dentro de un mensaje captura el store activo EN ESE MOMENTO
//    para ese mensaje, nunca el de un mensaje hermano (mismo mecanismo ya
//    probado por whatsappDbPerf.test.js para el timer de perf).
//  - Una excepción en un mensaje nunca deja nada corrupto para el
//    siguiente: cada llamada a processInboundMessage arranca con un Map
//    nuevo (enterWith crea uno vacío), nunca reutiliza el de una invocación
//    anterior.
//
// Web (conversation.controller.js) NUNCA llama a
// enterWithConversationStateRequestCache — para Web, getStore() siempre
// devuelve `undefined`, así que getCachedConversationState/
// setCachedConversationState son no-op y EventCreationEngine cae directo a
// Prisma en cada lectura, exactamente igual que antes de este cambio (cero
// diferencia funcional para Web).
import { AsyncLocalStorage } from "node:async_hooks";

const requestCacheStorage = new AsyncLocalStorage();

export function enterWithConversationStateRequestCache() {
    requestCacheStorage.enterWith(new Map());
}

function getActiveCache() {
    return requestCacheStorage.getStore() ?? null;
}

// `null` tanto si no hay contexto activo (Web) como si el conversationId
// todavía no se leyó en este mensaje — en ambos casos el caller debe ir a
// buscarlo a Prisma, la distinción no le importa a quien llama.
export function getCachedConversationState(conversationId) {
    return getActiveCache()?.get(conversationId) ?? null;
}

// No-op silencioso sin contexto activo (Web) — nunca crea una Map "de
// respaldo" ni lanza: cachear es puramente una optimización, nunca un
// requisito para que la lectura/escritura real funcione.
export function setCachedConversationState(state) {
    getActiveCache()?.set(state.id, state);
}

// Usado tanto tras un delete real (cancel) como cuando una escritura
// condicional detecta que la copia cacheada quedó obsoleta (ver
// applyConversationUpdate en EventCreationEngine.js) — nunca se deja una
// copia stale disponible para una lectura posterior dentro del mismo
// mensaje.
export function invalidateCachedConversationState(conversationId) {
    getActiveCache()?.delete(conversationId);
}
