import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAY_LABELS, MONTH_LABELS, startOfDay, toLocalDateString, sameDay, buildMonthGrid } from "../../../../lib/dateGrid.js";

// Selector de fecha estilo chat: calendario navegable con accesos rápidos
// (Hoy/Mañana), sin submit explícito — tocar un día ya envía la respuesta,
// igual que las tarjetas de SingleSelectCards/YesNoAnswer.
export default function DateAnswer({ onSubmit, disabled }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewedMonth, setViewedMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const days = useMemo(
    () => buildMonthGrid(viewedMonth.getFullYear(), viewedMonth.getMonth()),
    [viewedMonth]
  );

  const tomorrow = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }, [today]);

  function selectDate(date) {
    if (disabled || date < today) return;
    onSubmit(toLocalDateString(date));
  }

  function goToMonth(offset) {
    setViewedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  const isPrevDisabled =
    viewedMonth.getFullYear() === today.getFullYear() && viewedMonth.getMonth() === today.getMonth();

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => selectDate(today)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-200 transition-colors duration-150 hover:border-violet-500/60 hover:bg-violet-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Hoy
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => selectDate(tomorrow)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-200 transition-colors duration-150 hover:border-violet-500/60 hover:bg-violet-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mañana
        </button>
      </div>

      <div className="w-full max-w-sm self-center rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            disabled={disabled || isPrevDisabled}
            onClick={() => goToMonth(-1)}
            className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-white">
            {MONTH_LABELS[viewedMonth.getMonth()]} {viewedMonth.getFullYear()}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => goToMonth(1)}
            className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className="py-1 text-center text-[11px] font-medium text-slate-500">
              {label}
            </span>
          ))}

          {days.map((date) => {
            const inCurrentMonth = date.getMonth() === viewedMonth.getMonth();
            const isPast = date < today;
            const isToday = sameDay(date, today);
            const textClass = inCurrentMonth && !isPast ? "text-slate-200" : "text-slate-600";

            return (
              <button
                key={date.toISOString()}
                type="button"
                disabled={disabled || isPast}
                onClick={() => selectDate(date)}
                className={`aspect-square rounded-lg text-sm transition-colors duration-150 disabled:cursor-not-allowed ${textClass} ${
                  isToday ? "border border-violet-500/60" : ""
                } ${!isPast ? "hover:bg-violet-500/20 hover:text-white" : ""}`}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
