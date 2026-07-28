// Franjas horarias con sus horarios habituales para un evento (matinée /
// tarde / noche), cada 30 minutos. Cubre 08:00 a 23:30. Compartido entre el
// selector de horario del chat (TimeAnswer) y el del wizard (TimePicker)
// para que ambos ofrezcan exactamente los mismos horarios.
export const PERIODS = [
  { label: "Mañana", start: 8, end: 12 },
  { label: "Tarde", start: 12, end: 19 },
  { label: "Noche", start: 19, end: 24 },
];

export function buildSlots(start, end) {
  return Array.from({ length: (end - start) * 2 }, (_, i) => {
    const h = start + Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    return `${String(h).padStart(2, "0")}:${m}`;
  });
}

// Para "horario exacto": dos selects propios (hora/minuto) en vez del
// <input type="time"> nativo, cuyo selector de scroll con AM/PM del
// navegador rompe la estética del resto del selector.
export const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
export const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, "0"));
