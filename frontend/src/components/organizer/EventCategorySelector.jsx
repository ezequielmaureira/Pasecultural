import { ChevronLeft, ChevronRight } from "lucide-react";

// Segmented control (no dropdown, no filtro clásico) para elegir qué
// categoría de eventos alimenta el resto del Dashboard. Genérico: sólo
// necesita los 3 contadores y el estado actual — no sabe nada de
// eventos/funciones/organizador, así que sirve igual para cualquier otra
// pantalla que necesite el mismo patrón de selección.
const CATEGORIES = [
  { key: "upcoming", label: "Próximos", emoji: "📅" },
  { key: "ongoing", label: "En curso", emoji: "🎉" },
  { key: "finished", label: "Finalizados", emoji: "📚" },
];

function CategoryTab({ category, isActive, count, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(category.key)}
      aria-pressed={isActive}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1120] ${
        isActive ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span aria-hidden="true">{category.emoji}</span>
      {category.label}
      <span className={isActive ? "text-violet-200" : "text-slate-500"}>({count})</span>
    </button>
  );
}

// `currentLabel`/`currentIndex`/`total` describen el evento actualmente
// mostrado dentro de la categoría activa — el paginador (flechas) sólo se
// muestra si hay más de uno, para no ocupar espacio cuando no hace falta
// navegar.
export default function EventCategorySelector({
  counts,
  selected,
  onSelect,
  currentLabel,
  currentIndex = 0,
  total = 0,
  onPrevious,
  onNext,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="inline-flex w-fit flex-wrap gap-1 rounded-xl border border-white/10 bg-[#0B1120] p-1">
        {CATEGORIES.map((category) => (
          <CategoryTab
            key={category.key}
            category={category}
            isActive={selected === category.key}
            count={counts[category.key] ?? 0}
            onSelect={onSelect}
          />
        ))}
      </div>

      {total > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <button
            type="button"
            onClick={onPrevious}
            disabled={currentIndex <= 0}
            aria-label="Evento anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-0 truncate text-xs">
            <span className="text-slate-300">{currentLabel}</span> · {currentIndex + 1} de {total}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= total - 1}
            aria-label="Evento siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
