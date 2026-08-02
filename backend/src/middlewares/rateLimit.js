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

export function rateLimit({ windowMs, max, message = "Demasiados intentos. Probá de nuevo en unos minutos." }) {
    // Cada llamada a rateLimit() es un límite independiente — el id evita
    // que dos endpoints distintos (ej. /recover y /resend-email) compartan
    // sin querer el mismo contador sólo por venir de la misma IP.
    const limiterId = nextLimiterId++;

    return (req, res, next) => {
        const key = `${limiterId}:${req.ip || "unknown"}`;
        const now = Date.now();
        const recent = (attemptsByKey.get(key) || []).filter((t) => now - t < windowMs);

        if (recent.length >= max) {
            return res.status(429).json({ message });
        }

        recent.push(now);
        attemptsByKey.set(key, recent);
        next();
    };
}
