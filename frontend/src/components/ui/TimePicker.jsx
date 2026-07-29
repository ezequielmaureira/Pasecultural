import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { PERIODS, buildSlots, HOURS, MINUTES } from "../../lib/timeSlots.js";

const exactSelectClass =
  "h-7 rounded-md border border-white/10 bg-white/5 px-1.5 text-xs text-gray-100 outline-none focus:border-violet-500";

// Selector de horario en dropdown: mismos chips de horarios (cada 30 min,
// agrupados por franja) que el TimeAnswer del chat, pero compacto para
// convivir con otros campos del formulario del wizard. Reemplaza al
// <input type="time"> nativo del navegador, que no distingue franjas y
// obliga a escribir el horario a mano.
export default function TimePicker({ value, onChange, placeholder = "Elegir horario" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleDocumentClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  function select(slot) {
    onChange(slot);
    setOpen(false);
  }

  const [exactHour, exactMinute] = (value || "21:00").split(":");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm outline-none transition-colors duration-150 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${
          value ? "text-gray-100" : "text-slate-500"
        }`}
      >
        <Clock className="h-4 w-4 shrink-0 text-slate-500" />
        {value || placeholder}
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-white/10 bg-[#0B1120] p-3 shadow-xl">
          {PERIODS.map((period) => (
            <div key={period.label} className="mb-3 flex flex-col gap-1.5 last:mb-0">
              <span className="text-[11px] font-medium text-slate-500">{period.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {buildSlots(period.start, period.end).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => select(slot)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                      slot === value
                        ? "bg-violet-600 text-white"
                        : "bg-white/5 text-slate-300 hover:bg-violet-500/20 hover:text-white"
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs text-slate-400">
            Horario exacto
            <div className="flex items-center gap-1">
              <select
                className={exactSelectClass}
                value={exactHour}
                onChange={(e) => select(`${e.target.value}:${exactMinute}`)}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h} className="bg-[#0B1120]">
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-slate-500">:</span>
              <select
                className={exactSelectClass}
                value={exactMinute}
                onChange={(e) => select(`${exactHour}:${e.target.value}`)}
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m} className="bg-[#0B1120]">
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
