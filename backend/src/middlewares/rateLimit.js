// Limitador liviano en memoria — sin dependencias nuevas. Pensado
// específicamente para endpoints públicos "de adivinanza" (recuperar
// compra por email+DNI, reenviar email) donde alguien podría intentar
// muchas combinaciones seguidas. No es un rate limiter de producción
// completo (no sobrevive un restart, no se comparte entre instancias si el
// día de mañana el backend corre en más de un proceso/dron) — para eso
// haría falta un store compartido (Redis). Para el volumen actual de
// PaseCultural, alcanza y sobra.
const attemptsByKey = new Map();
let nextLimiterId = 0;

// Una entrada por (límite, IP) que nunca se borraba: con tráfico real el
// Map sólo crecía. Cada PRUNE_EVERY_MS se descartan las claves cuyo último
// intento ya quedó fuera de la ventana más larga posible (1 h alcanza para
// todos los límites actuales, el mayor es de 15 min).
const PRUNE_EVERY_MS = 5 * 60 * 1000;
const MAX_WINDOW_MS = 60 * 60 * 1000;
let lastPruneAt = Date.now();

function pruneStaleKeys(now) {
    if (now - lastPruneAt < PRUNE_EVERY_MS) return;
    lastPruneAt = now;
    for (const [key, timestamps] of attemptsByKey) {
        if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] >= MAX_WINDOW_MS) attemptsByKey.delete(key);
    }
}

export function getRateLimitKeyCountForTests() {
    return attemptsByKey.size;
}

export function rateLimit({ windowMs, max, message = "Demasiados intentos. Probá de nuevo en unos minutos." }) {
    // Cada llamada a rateLimit() es un límite independiente — el id evita
    // que dos endpoints distintos (ej. /recover y /resend-email) compartan
    // sin querer el mismo contador sólo por venir de la misma IP.
    const limiterId = nextLimiterId++;

    return (req, res, next) => {
        const key = `${limiterId}:${req.ip || "unknown"}`;
        const now = Date.now();
        pruneStaleKeys(now);
        const recent = (attemptsByKey.get(key) || []).filter((t) => now - t < windowMs);

        if (recent.length >= max) {
            return res.status(429).json({ message });
        }

        recent.push(now);
        attemptsByKey.set(key, recent);
        next();
    };
}
