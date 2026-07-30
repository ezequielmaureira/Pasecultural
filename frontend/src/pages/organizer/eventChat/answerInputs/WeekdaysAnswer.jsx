import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";

const DAYS = [
  { id: 0, label: "Lunes" },
  { id: 1, label: "Martes" },
  { id: 2, label: "Miércoles" },
  { id: 3, label: "Jueves" },
  { id: 4, label: "Viernes" },
  { id: 5, label: "Sábado" },
  { id: 6, label: "Domingo" },
];

export default function WeekdaysAnswer({ onSubmit, disabled, currentValue }) {
  const [selected, setSelected] = useState(currentValue ?? []);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  function submit() {
    if (selected.length === 0 || disabled) return;
    onSubmit(selected);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {DAYS.map((day) => (
          <button
            key={day.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(day.id)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected.includes(day.id)
                ? "border-violet-500/60 bg-violet-500/20 text-white"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-500/40 hover:bg-violet-500/10"
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>

      <Button
        type="button"
        onClick={submit}
        disabled={disabled || selected.length === 0}
        className="w-full self-stretch sm:w-auto sm:self-end"
      >
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
