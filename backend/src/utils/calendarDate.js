// Único módulo del backend para "fechas de calendario" (YYYY-MM-DD, sin
// hora) — usado por el motor de conversación (inputHandlers/*, steps/
// definitions.js) para cualquier respuesta de tipo fecha/rango/función.
//
// Regla del proyecto (espeja frontend/src/lib/dateGrid.js): una fecha de
// calendario NO representa un instante, sólo un día. Por eso nunca pasa por
// `new Date(string)` (ECMA-262 interpreta un string de sólo-fecha como
// medianoche UTC, lo que la corre un día para cualquier timezone detrás de
// UTC — la causa raíz del bug de desincronización del DatePicker) ni por la
// timezone del proceso que ejecuta el código. Toda la aritmética de acá usa
// Date.UTC()/getUTC*() como una calculadora de calendario pura, nunca para
// representar un instante real.
//
// Los timestamps reales (createdAt/updatedAt/checkInAt/scannedAt/etc.) NO
// pasan por este módulo — siguen siendo Date/ISO UTC como siempre.

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

// Timezone oficial de la plataforma (100% Argentina hoy): offset fijo, sin
// horario de verano (Argentina no lo usa desde 2009), así que no hace falta
// una librería de timezones (Intl/IANA) para esto — un offset constante ya
// es correcto. Si el día de mañana la plataforma opera en más de una
// timezone, este es el único lugar a tocar.
const PLATFORM_UTC_OFFSET = "-03:00";

// Valida y normaliza a "YYYY-MM-DD" estricto — nunca instancia un Date con
// el string completo. Acepta también un string más largo (ej. un valor
// legado guardado con hora/offset antes de esta migración) y se queda sólo
// con los primeros 10 caracteres, por compatibilidad con datos ya
// persistidos. Devuelve null si no es una fecha de calendario válida (incluye
// rechazar días que no existen, ej. 2026-02-30).
export function normalizeCalendarDateString(raw) {
    if (typeof raw !== "string") return null;
    const match = CALENDAR_DATE_PATTERN.exec(raw.trim());
    if (!match) return null;
    const [, year, month, day] = match;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);

    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
        return null;
    }
    return `${year}-${month}-${day}`;
}

export function isValidCalendarDateString(raw) {
    return normalizeCalendarDateString(raw) !== null;
}

// Comparador de fechas de calendario (string) — <0/0/>0, como cualquier
// comparador. Válido porque "YYYY-MM-DD" ordena igual lexicográfica y
// cronológicamente.
export function compareCalendarDateStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Suma `days` días de calendario a una fecha "YYYY-MM-DD" — aritmética UTC
// pura, nunca local: el resultado no depende de la timezone del servidor.
export function addCalendarDays(dateString, days) {
    const [, year, month, day] = CALENDAR_DATE_PATTERN.exec(dateString);
    const next = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// Día de semana de una fecha de calendario, 0=Lunes..6=Domingo — misma
// convención que lib/dateGrid.js en el frontend.
export function calendarWeekday(dateString) {
    const [, year, month, day] = CALENDAR_DATE_PATTERN.exec(dateString);
    const utcDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
    return (utcDay + 6) % 7;
}

// Combina una fecha de calendario + una hora "HH:mm" en el instante real
// (ISO UTC) que representan en la timezone de la plataforma — único punto
// del backend que construye un timestamp real a partir de una fecha de
// calendario. El offset va explícito en el string ("-03:00"), así que el
// resultado es el mismo sin importar en qué timezone corra el proceso de
// Node — a diferencia de `new Date("...T21:00:00")` sin offset, que se
// interpreta con la timezone del proceso (la causa del bug en
// EventServicePort.js).
export function combineCalendarDateTime(dateString, timeString) {
    const normalized = normalizeCalendarDateString(dateString);
    if (!normalized || typeof timeString !== "string") return null;
    return new Date(`${normalized}T${timeString}:00${PLATFORM_UTC_OFFSET}`).toISOString();
}
