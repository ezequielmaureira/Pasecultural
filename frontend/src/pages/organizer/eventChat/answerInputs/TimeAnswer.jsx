import { useState } from "react";
import { Check, Clock } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { PERIODS, buildSlots, HOURS, MINUTES } from "../../../../lib/timeSlots.js";

const selectClass =
  "h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20";

// Selector de horario estilo chat: chips con los horarios más usuales
// agrupados por franja (un click ya envía la respuesta, sin submit
// aparte) y un campo de horario exacto para los casos que no caen en
// la grilla de cada 30 minutos. El horario exacto usa dos selects propios
// (hora/minuto) en vez de <input type="time">, cuyo picker nativo del
// navegador (scroll con AM/PM) rompe la estética del resto del selector.
export default function TimeAnswer({ onSubmit, disabled }) {
  const [customMode, setCustomMode] = useState(false);
  const [hour, setHour] = useState("21");
  const [minute, setMinute] = useState("00");

  function submitCustom(e) {
    e.preventDefault();
    if (disabled) return;
    onSubmit(`${hour}:${minute}`);
  }

  if (customMode) {
    return (
      <form className="flex w-full flex-col items-center gap-2" onSubmit={submitCustom}>
        <div className="flex items-center gap-2">
          <select
            autoFocus
            className={selectClass}
            value={hour}
            disabled={disabled}
            onChange={(e) => setHour(e.target.value)}
          >
            {HOURS.map((h) => (
              <option key={h} value={h} className="bg-[#0B1120]">
                {h}
              </option>
            ))}
          </select>
          <span className="text-lg font-semibold text-slate-400">:</span>
          <select
            className={selectClass}
            value={minute}
            disabled={disabled}
            onChange={(e) => setMinute(e.target.value)}
          >
            {MINUTES.map((m) => (
              <option key={m} value={m} className="bg-[#0B1120]">
                {m}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={disabled}>
            <Check className="h-4 w-4" />
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setCustomMode(false)}
          className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Volver a los horarios sugeridos
        </button>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {PERIODS.map((period) => (
        <div key={period.label} className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-500">{period.label}</span>
          <div className="flex flex-wrap gap-2">
            {buildSlots(period.start, period.end).map((slot) => (
              <button
                key={slot}
                type="button"
                disabled={disabled}
                onClick={() => onSubmit(slot)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:border-violet-500/60 hover:bg-violet-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slot}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setCustomMode(true)}
        className="flex w-fit items-center gap-1.5 self-center text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Clock className="h-3.5 w-3.5" />
        Elegir un horario exacto
      </button>
    </div>
  );
}
