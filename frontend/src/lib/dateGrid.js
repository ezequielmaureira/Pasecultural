// Única infraestructura del proyecto para "fechas de calendario"
// (YYYY-MM-DD, sin hora) — usada por DatePicker, DateAnswer, ScheduleRowsEditor
// y cualquier otra pantalla que edite/muestre una fecha de calendario.
//
// Regla del proyecto: una fecha de calendario NO representa un instante,
// sólo un día — nunca debe parsearse con `new Date(string)` (ECMA-262
// interpreta un string de sólo-fecha como medianoche UTC, lo que la corre un
// día para cualquier timezone detrás de UTC — Argentina incluida) ni
// depender de la timezone del navegador. `parseLocalDate`/`toLocalDateString`
// son los únicos puntos de conversión string ↔ Date de todo el frontend; el
// objeto `Date` que producen existe sólo para interactuar con el calendario
// (comparar/pintar celdas), nunca se persiste ni se manda al backend como
// tal — lo que viaja siempre es el string "YYYY-MM-DD".
//
// Los timestamps reales (createdAt/updatedAt/checkInAt/función.date/etc.)
// NO pasan por acá — siguen usando `new Date(iso)`/`toLocaleString` como
// siempre: son instantes de verdad, con offset explícito en el string.
export const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// "YYYY-MM-DD" (u opcionalmente con hora/offset detrás, por compatibilidad
// con datos legados) -> Date a medianoche LOCAL. Construye con el
// constructor de 3 argumentos (year, monthIndex, day), que SIEMPRE es local
// — nunca delega en el parser de strings de `Date`, así que el resultado no
// depende de si el string tiene o no un componente de hora.
export function parseLocalDate(dateString) {
  if (typeof dateString !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rechaza días que no existen (ej. "2026-02-30") en vez de que Date los
  // "corrija" silenciosamente corriéndose de mes.
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    return null;
  }
  return date;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Date (local) -> "YYYY-MM-DD", usando los campos LOCALES del objeto — el
// inverso exacto de parseLocalDate.
export function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Formato legible ("viernes, 8 de agosto de 2026") de una fecha de
// calendario para mostrar en resúmenes/preview — siempre vía parseLocalDate,
// nunca `new Date(dateString)` directo. Cadena vacía si no es una fecha
// válida (mismo criterio que el resto de los formatters de fecha del proyecto).
export function formatLocalDate(
  dateString,
  options = { weekday: "long", day: "2-digit", month: "long", year: "numeric" }
) {
  const date = parseLocalDate(dateString);
  if (!date) return "";
  return date.toLocaleDateString("es-AR", options);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Grilla de 6 semanas (Lunes-Domingo) para el mes dado, incluyendo días
// "de relleno" del mes anterior/siguiente para completar la cuadrícula.
export function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Lunes
  const gridStart = new Date(year, month, 1 - firstWeekday);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return date;
  });
}
