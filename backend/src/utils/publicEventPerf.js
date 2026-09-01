// Performance Investigation 3 — instrumentación TEMPORAL, exclusiva del
// camino GET /api/events/public/:slug. Objetivo único: separar dónde se
// consumen los ~5.3s medidos en producción (requirePublicLaunch,
// event.findUnique, ticket.groupBy, procesamiento JS, baseline SELECT 1).
//
// Apagada por defecto (PUBLIC_EVENT_PERF_LOG=true la activa) — cuando está
// apagada, el único costo es una comparación de string por request; nunca
// se mide tiempo, nunca se llama a logger. Deliberadamente SEPARADA de
// whatsappPerf.js (WHATSAPP_PERF_LOG) — evita tocar esa instrumentación ya
// en uso en producción para un subsistema no relacionado.
//
// Nunca loguea PII ni datos sensibles: sólo `slug` (identificador público,
// ya visible en la URL del evento) y duraciones en ms. Ningún SQL, ningún
// argumento de query, ninguna credencial.
//
// RETIRO: este archivo y sus 3 call-sites (requirePublicLaunch.js,
// event.controller.js#getPublicEventBySlug, event.service.js —
// getPublicEventBySlugService/attachTicketAvailability) deben eliminarse
// por completo una vez que la medición en producción haya dado los
// números necesarios — ver el informe de la ronda "Performance
// Investigation 3" para el plan de retiro exacto (commit de instrumentación
// → medir → commit que la elimina).
import { logger } from "../logging/logger.js";

export function isPublicEventPerfLogEnabled() {
  return process.env.PUBLIC_EVENT_PERF_LOG === "true";
}

// `mark(name)` loguea, en una línea propia, cuánto pasó desde la marca
// anterior (o desde `startPublicEventPerfTimer`, para la primera) — nunca
// un acumulado. `finish()` loguea el total real de principio a fin. Ambos
// no-op si la variable de entorno está apagada.
export function startPublicEventPerfTimer(slug) {
  const enabled = isPublicEventPerfLogEnabled();
  const startedAt = process.hrtime.bigint();
  let lastMark = startedAt;

  return {
    enabled,
    mark(name) {
      if (!enabled) return;
      const now = process.hrtime.bigint();
      const ms = Math.round(Number(now - lastMark) / 1e5) / 10;
      lastMark = now;
      logger.info(`[PERF][public-event] ${name} ${ms}ms`, { slug });
    },
    finish() {
      if (!enabled) return;
      const totalMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
      logger.info(`[PERF][public-event] total ${totalMs}ms`, { slug });
    },
  };
}
