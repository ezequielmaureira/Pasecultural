// El resto de PaseCultural (frontend) formatea fechas con
// `toLocaleString("es-AR", {...})` SIN forzar timeZone, confiando en que el
// navegador del visitante ya está en horario argentino. Un email no tiene
// "navegador": lo renderiza este proceso de Node, que en producción corre en
// UTC — sin fijar timeZone acá, la fecha/hora del evento se correría (a
// veces incluso de día) según en qué huso esté el server. Por eso acá SÍ se
// fija explícitamente America/Argentina/Buenos_Aires: es hacer explícito lo
// que en el resto de la app queda implícito por el navegador, no una
// convención nueva.
const AR_TIMEZONE = "America/Argentina/Buenos_Aires";

export function formatFunctionDateTimeAR(date) {
    if (!date) return "Fecha a confirmar";
    return new Intl.DateTimeFormat("es-AR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: AR_TIMEZONE,
    }).format(new Date(date));
}
