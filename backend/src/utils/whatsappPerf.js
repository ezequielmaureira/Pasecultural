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
//
// Fase 3N — se agrega el desglose fino de operaciones Prisma (`dbCalls`,
// ver `recordDbCall`/`instrumentPrismaClient` más abajo): FASE 3M mostró en
// producción real que `SUBFLOW`/`BUILD_REPLY` son cajas negras de varios
// segundos (ej. PREVIEW_PUBLISH ≈21s) — sin poder ver CADA query individual
// dentro de esas etapas, no hay forma de distinguir "una operación de CPU
// lenta" de "N round-trips secuenciales a Postgres". Mismo criterio que el
// resto del archivo: no-op cuando está desactivado, nunca loguea PII, nunca
// loguea argumentos/payloads de las queries (sólo modelo+operación, ej.
// "conversationState.findFirst" — identificadores técnicos del schema,
// nunca datos).
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../logging/logger.js";

export function isWhatsappPerfLogEnabled() {
    return process.env.WHATSAPP_PERF_LOG === "true";
}

function truncateForCorrelation(id) {
    return typeof id === "string" ? id.slice(0, 8) : null;
}

// Tope defensivo — nunca debería alcanzarse en un mensaje real (el peor
// caso auditado, PREVIEW_PUBLISH, ronda ~20-25 queries), pero evita que un
// bug futuro (ej. un loop infinito) infle el log o la memoria sin límite.
const MAX_DB_CALLS_RECORDED = 200;

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
    const dbCalls = [];

    return {
        enabled,
        mark(name) {
            if (!enabled) return;
            const now = process.hrtime.bigint();
            marks.push({ name, ms: Math.round(Number(now - lastMark) / 1e5) / 10 });
            lastMark = now;
        },
        // Cada operación Prisma real (una por query, nunca agregada) —
        // `label` es SIEMPRE "modelo.operacion" (ej. "event.findUnique"),
        // nunca datos ni argumentos. A diferencia de `mark`, no se resta
        // contra la marca anterior: `ms` es la duración PROPIA de esa
        // consulta puntual, así una etapa con varias queries secuenciales
        // (ej. SUBFLOW) se puede abrir en sus componentes reales.
        recordDbCall(label, ms) {
            if (!enabled) return;
            if (dbCalls.length >= MAX_DB_CALLS_RECORDED) return;
            dbCalls.push({ label, ms });
        },
        finish({ conversationId, ...extra } = {}) {
            if (!enabled) return;
            const totalMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
            const dbTotalMs = Math.round(dbCalls.reduce((sum, call) => sum + call.ms, 0) * 10) / 10;
            logger.info("[WA_PERF]", {
                conv: truncateForCorrelation(conversationId),
                ...extra,
                totalMs,
                marks,
                dbCallCount: dbCalls.length,
                dbTotalMs,
                dbCalls,
            });
        },
    };
}

// ==================================================================
// Fase 3N — correlación del timer activo con cada query Prisma real, sin
// tener que pasar el timer a mano por cada uno de los ~15 archivos de
// servicio que llaman a Prisma (eso sí sería el "cambio grande" que esta
// fase evita). AsyncLocalStorage es la herramienta estándar de Node para
// exactamente este problema: propagar "en qué request estamos" a través de
// cualquier cadena de `await`, sin tocar la firma de ninguna función
// intermedia. `enterWithActiveTimer` se llama UNA vez, al principio de
// processInboundMessage — todo lo que ese mismo mensaje haga después (el
// motor, los services, Prisma) ve el mismo timer vía `getActiveTimer()`,
// automáticamente. Dos mensajes procesados en paralelo (ver
// processInboundMessages/Promise.allSettled) nunca se mezclan entre sí:
// cada uno tiene su propio contexto asíncrono.
const activeTimerStorage = new AsyncLocalStorage();

export function enterWithActiveTimer(timer) {
    activeTimerStorage.enterWith(timer);
}

function getActiveTimer() {
    return activeTimerStorage.getStore() ?? null;
}

// Envuelve un PrismaClient (o un cliente ya extendido) para que CADA
// operación real (find/create/update/delete/etc., cualquier modelo) quede
// medida y asociada al timer activo del mensaje que la disparó — sin tocar
// un solo call-site de los servicios existentes (event.service.js,
// EventCreationEngine.js, whatsappOrganizerDiscovery.service.js, etc.).
// Cuando WHATSAPP_PERF_LOG no está activo, el costo extra es una sola
// comparación (`isWhatsappPerfLogEnabled()`) antes de delegar a la query
// real — nunca se mide tiempo, nunca se toca AsyncLocalStorage. Nunca
// loguea `args` (podría traer teléfono/nombre/dirección/precio): sólo el
// nombre del modelo y de la operación, que son identificadores técnicos
// del schema, no datos.
export function instrumentPrismaClient(client) {
    return client.$extends({
        name: "whatsapp-db-perf",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (!isWhatsappPerfLogEnabled()) return query(args);
                    const timer = getActiveTimer();
                    if (!timer) return query(args);

                    const startedAt = process.hrtime.bigint();
                    const result = await query(args);
                    const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
                    timer.recordDbCall(`${model ?? "raw"}.${operation}`, ms);
                    return result;
                },
            },
        },
    });
}
