import { FileText, CalendarDays, MapPin, Image, Ticket, Video, Share2, Rocket, Check } from "lucide-react";

// Un ícono por sección, sólo para que se puedan reconocer de un vistazo,
// especialmente en mobile — no aporta significado propio más allá de eso.
const ICON_BY_SECTION = {
  INFO: FileText,
  FECHA: CalendarDays,
  UBICACION: MapPin,
  IMAGEN: Image,
  ENTRADAS: Ticket,
  VIDEO: Video,
  REDES: Share2,
  PUBLICACION: Rocket,
};

const TONE_BY_STATUS = {
  current: "border-violet-500/60 bg-violet-500/15 text-white",
  completed: "border-white/10 bg-white/5 text-slate-300 hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white",
  pending: "cursor-not-allowed border-white/5 bg-transparent text-slate-600",
};

// Navegador de secciones: única fuente de verdad es `sections`, tal como lo
// devuelve el motor (steps/sections.js + EventCreationEngine.computeSectionStatuses)
// — este componente no sabe nada de qué stepId corresponde a qué sección,
// sólo pinta lo que le llega y dispara GOTO al hacer click. "pending" nunca
// es clickeable: el motor ya decide qué se alcanzó y qué no.
export default function SectionsNav({ sections, onSelect, disabled }) {
  if (!sections?.length) return null;

  return (
    <nav
      aria-label="Secciones del evento"
      className="no-scrollbar flex w-full max-w-2xl items-center gap-1.5 overflow-x-auto px-1 py-1"
    >
      {sections.map((section) => {
        const Icon = ICON_BY_SECTION[section.id] ?? FileText;
        const isCurrent = section.status === "current";
        const isCompleted = section.status === "completed";
        const isClickable = !disabled && (isCompleted || isCurrent);
        const toneClass = TONE_BY_STATUS[section.status] ?? TONE_BY_STATUS.pending;

        return (
          <button
            key={section.id}
            type="button"
            disabled={!isClickable}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => onSelect(section.targetStepId)}
            title={section.label}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${toneClass}`}
          >
            {isCompleted ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Icon className="h-3.5 w-3.5" />}
            <span className="whitespace-nowrap">{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
