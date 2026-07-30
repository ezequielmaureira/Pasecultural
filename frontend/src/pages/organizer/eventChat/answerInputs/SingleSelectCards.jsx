import { useMemo, useState } from "react";
import { Circle, Search } from "lucide-react";
import { inputClass } from "../../../../components/ui/FormField.jsx";

// Umbral a partir del cual mostrar el buscador: con listas cortas (ej. redes
// sociales, 7 opciones) no aporta y sólo ocupa espacio.
const SEARCH_THRESHOLD = 8;

// Tarjetas seleccionables genéricas para cualquier paso SINGLE_SELECT del
// motor (categoría, red social, etc). `getIcon` es opcional y se resuelve
// por afuera según el stepId (ver QuestionRenderer.jsx).
export default function SingleSelectCards({ options, onSubmit, disabled, getIcon, currentValue }) {
  const [search, setSearch] = useState("");
  const allOptions = options ?? [];

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allOptions;
    return allOptions.filter((option) => option.label.toLowerCase().includes(term));
  }, [allOptions, search]);

  return (
    <div className="flex w-full flex-col gap-3">
      {allOptions.length > SEARCH_THRESHOLD && (
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            type="text"
            className={`${inputClass} pl-9`}
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
          />
        </div>
      )}

      {filteredOptions.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No encontramos ninguna opción con ese texto.</p>
      ) : (
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
          {filteredOptions.map((option) => {
            const Icon = getIcon ? getIcon(option.id) : Circle;
            const isSelected = currentValue !== undefined && option.id === currentValue;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => onSubmit(option.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center text-sm font-medium transition-colors duration-150 hover:border-violet-500/60 hover:bg-violet-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSelected
                    ? "border-violet-500/60 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/5 text-slate-200"
                }`}
              >
                <Icon className="h-6 w-6 text-violet-400" />
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
