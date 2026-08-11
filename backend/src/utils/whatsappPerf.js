// Fase 3H — instrumentación de performance del adaptador WhatsApp.
// Puramente diagnóstica y DESACTIVADA por defecto: no debe agregar costo ni
// ruido en producción salvo que alguien la prenda a propósito para medir.
//
// Activación: variable de entorno WHATSAPP_PERF_LOG=true. NO se configuró
// en Render como parte de esta fase (ver informe de entrega) — activarla
// requiere agregarla manualmente en el dashboard de Render el día que haga
// falta medir de nuevo.
//
// Nunca se loguea PII: ni teléfono, ni wa_id, ni nombre, ni texto del
// mensaje, ni tokens. Sólo duraciones en ms, stepId/inputType (identificadores
// técnicos del motor, no datos personales), tipo de mensaje y un
// conversationId TRUNCADO a 8 caracteres — sólo para poder correlacionar las
// líneas de un mismo mensaje entre sí en un mismo request, nunca para
// identificar a la persona.
import { logger } from "../logging/logger.js";

export function isWhatsappPerfLogEnabled() {
    return process.env.WHATSAPP_PERF_LOG === "true";
}

function truncateForCorrelation(id) {
    return typeof id === "string" ? id.slice(0, 8) : null;
}

// `mark(name)` registra cuánto pasó desde la marca anterior (o desde el
// arranque, para la primera). `finish(extra)` imprime UNA línea [WA_PERF]
// con todas las marcas + el total — `extra.conversationId`, si se pasa, se
// trunca automáticamente (el conversationId real recién se conoce después
// de findActiveConversation, bien después de arrancar el timer). Cuando
// está desactivado, todas las operaciones son no-op (sólo dos lecturas de
// reloj: startedAt acá y una en finish — despreciable, nunca se hace
// trabajo extra de log ni se llama a logger.info).
export function startWhatsappPerfTimer() {
    const enabled = isWhatsappPerfLogEnabled();
    const startedAt = process.hrtime.bigint();
    let lastMark = startedAt;
    const marks = [];

    return {
        enabled,
        mark(name) {
            if (!enabled) return;
            const now = process.hrtime.bigint();
            marks.push({ name, ms: Math.round(Number(now - lastMark) / 1e5) / 10 });
            lastMark = now;
        },
        finish({ conversationId, ...extra } = {}) {
            if (!enabled) return;
            const totalMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
            logger.info("[WA_PERF]", {
                conv: truncateForCorrelation(conversationId),
                ...extra,
                totalMs,
                marks,
            });
        },
    };
}
