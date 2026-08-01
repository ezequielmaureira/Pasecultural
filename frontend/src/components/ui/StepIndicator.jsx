// Extraído de OrganizerEventWizard.jsx para que cualquier flujo por pasos de
// la app (wizard de creación de eventos, wizard de compra, etc.) use el
// mismo indicador — mismos círculos, mismos colores, mismo comportamiento.
// `clickable` habilita saltar directo a cualquier paso tocando su círculo
// (sólo tiene sentido cuando el orden ya no importa, ej. reeditar un
// borrador existente).
export default function StepIndicator({ steps, step, onStepClick, clickable }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2 overflow-x-auto pb-1">
      {steps.map((s, index) => (
        <div key={s.id} className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!clickable}
            onClick={() => onStepClick(s.id)}
            className={`flex flex-col items-center gap-1.5 rounded-lg ${
              clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-150 ${
                s.id === step
                  ? "bg-violet-600 text-white"
                  : s.id < step
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-white/5 text-slate-500"
              }`}
            >
              {s.id}
            </div>
            <span
              className={`hidden text-[11px] sm:block ${
                s.id === step ? "text-violet-300" : "text-slate-500"
              }`}
            >
              {s.label}
            </span>
          </button>
          {index < steps.length - 1 && (
            <div className="h-px w-8 shrink-0 bg-white/10 sm:w-12" />
          )}
        </div>
      ))}
    </div>
  );
}
