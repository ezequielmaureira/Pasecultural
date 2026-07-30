// Interfaz de logging angosta y con niveles separados desde el día uno
// (debug/info/warn/error). Hoy escribe por console, pero cualquier
// integración futura (Sentry, Pino, Datadog) se resuelve reemplazando la
// implementación de `write` acá adentro — ningún call-site (`logger.error(...)`,
// `logger.info(...)`) tiene que cambiar cuando eso pase.
function write(level, message, context = {}) {
    const line = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...context,
    };
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    console[method](JSON.stringify(line));
}

// logger.error acepta tanto un AppError (vuelca code/errorId/stack/cause
// automáticamente) como un mensaje simple, para no obligar a envolver todo
// en un AppError sólo para dejar un log.
function logError(errorOrMessage, context = {}) {
    const isError = errorOrMessage instanceof Error;
    const errorFields = isError
        ? {
              errorId: errorOrMessage.errorId,
              code: errorOrMessage.code,
              stack: errorOrMessage.stack,
              cause: errorOrMessage.cause?.message,
          }
        : {};

    write("error", isError ? errorOrMessage.message : errorOrMessage, { ...errorFields, ...context });
}

export const logger = {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: logError,
};
