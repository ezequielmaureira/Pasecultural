import { X } from "lucide-react";
import Button from "../ui/Button.jsx";

// Card flotante puramente presentacional — TutorialSpotlight.jsx la
// posiciona ya calculada (top/left/placement) y le pasa el contenido
// resuelto desde el registry (tutorials/organizerEventTutorial.js).
// `videoUrl` viene preparado para un futuro video por paso — hoy siempre
// null, este componente simplemente no renderiza nada si no llega.
export default function TutorialCallout({
  title,
  description,
  videoUrl,
  index,
  total,
  placement,
  style,
  calloutRef,
  onDismiss,
  onExitTutorial,
}) {
  return (
    <div
      ref={calloutRef}
      role="dialog"
      aria-label={title}
      style={style}
      className="fixed z-[60] flex w-[300px] flex-col gap-3 rounded-2xl border border-brand/40 bg-[#111713] p-4 shadow-[0_0_0_1px_rgba(132,204,22,0.15),0_20px_50px_-15px_rgba(0,0,0,0.7),0_0_30px_-8px_rgba(132,204,22,0.45)] sm:w-[340px]"
    >
      {/* Flechita apuntando al target — sólo para top/bottom, que son los
          únicos placements que este componente recibe hoy (ver
          computePlacement en TutorialSpotlight.jsx). */}
      {(placement === "bottom" || placement === "top") && (
        <span
          aria-hidden="true"
          className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border border-brand/40 bg-[#111713] ${
            placement === "bottom" ? "-top-1.5 border-b-0 border-r-0" : "-bottom-1.5 border-l-0 border-t-0"
          }`}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-white">{title}</p>
        <button
          type="button"
          onClick={onExitTutorial}
          aria-label="Salir del tutorial"
          className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-white/5 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-300">{description}</p>

      {videoUrl && (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-white/10">
          <iframe src={videoUrl} title={title} className="h-full w-full" allowFullScreen />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {typeof index === "number" && typeof total === "number" ? (
          <span className="text-[11px] font-medium text-slate-500">
            {index}/{total}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExitTutorial}
            className="text-xs font-medium text-slate-500 transition-colors duration-150 hover:text-slate-300"
          >
            Salir del tutorial
          </button>
          <Button size="sm" onClick={onDismiss} className="px-3">
            Entendido
          </Button>
        </div>
      </div>
    </div>
  );
}
