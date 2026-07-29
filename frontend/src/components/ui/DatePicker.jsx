import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAY_LABELS, MONTH_LABELS, startOfDay, toIsoDate, sameDay, buildMonthGrid } from "../../lib/dateGrid.js";

// Selector de fecha en dropdown: mismo calendario navegable que DateAnswer
// (chat), pero embebible dentro de tarjetas/listas compactas (ej. la tarjeta
// de "una sola función" o cada fila del administrador de funciones), donde
// auto-enviar al tocar un día no tiene sentido — acá sólo guarda el valor.
export default function DatePicker({ value, onChange, placeholder = "Elegir fecha" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const today = useMemo(() => startOfDay(new Date()), []);

  const initialMonth = value ? new Date(value) : today;
  const [viewedMonth, setViewedMonth] = useState(
    () => new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1)
  );

  useEffect(() => {
    function handleDocumentClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  const days = useMemo(
    () => buildMonthGrid(viewedMonth.getFullYear(), viewedMonth.getMonth()),
    [viewedMonth]
  );

  function select(date) {
    if (date < today) return;
    onChange(toIsoDate(date));
    setOpen(false);
  }

  function goToMonth(offset) {
    setViewedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  const isPrevDisabled =
    viewedMonth.getFullYear() === today.getFullYear() && viewedMonth.getMonth() === today.getMonth();
  const selectedDate = value ? startOfDay(new Date(value)) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm outline-none transition-colors duration-150 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${
          value ? "text-gray-100" : "text-slate-500"
        }`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
        {value || placeholder}
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-white/10 bg-[#0B1120] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              disabled={isPrevDisabled}
              onClick={() => goToMonth(-1)}
              className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-semibold text-white">
              {MONTH_LABELS[viewedMonth.getMonth()]} {viewedMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => goToMonth(1)}
              className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-1 text-center text-[10px] font-medium text-slate-500">
                {label}
              </span>
            ))}

            {days.map((date) => {
              const inCurrentMonth = date.getMonth() === viewedMonth.getMonth();
              const isPast = date < today;
              const isToday = sameDay(date, today);
              const isSelected = selectedDate && sameDay(date, selectedDate);
              const textClass = inCurrentMonth && !isPast ? "text-slate-200" : "text-slate-600";

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={isPast}
                  onClick={() => select(date)}
                  className={`aspect-square rounded-md text-xs transition-colors duration-150 disabled:cursor-not-allowed ${textClass} ${
                    isSelected ? "bg-violet-600 text-white" : isToday ? "border border-violet-500/60" : ""
                  } ${!isPast && !isSelected ? "hover:bg-violet-500/20 hover:text-white" : ""}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
