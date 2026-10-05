import { Archive, Copy } from "lucide-react";
import Button from "../ui/Button.jsx";

// Se muestra en vez del wizard de edición cuando el evento cargado ya está
// archivado (ver OrganizerEventWizard.jsx) — "no quiero editar directamente
// un evento archivado". Este evento está en modo solo lectura de forma
// permanente (ver el informe de la ronda "Retiro de Restaurar Evento"): no
// existe un camino de vuelta a Eventos vigentes. Únicamente ofrece
// Duplicar, nunca acciones operativas (guardar, publicar, programar
// funciones, etc.).
export default function ArchivedEventBanner({ onDuplicate, duplicating }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Archive className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-200">
            Este evento está en tu Historial. Su información se conserva en modo solo lectura.
          </p>
          <p className="mt-1 text-xs text-amber-300/80">
            Si querés crear una nueva edición, podés duplicarlo.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={onDuplicate} loading={duplicating} loadingText="Duplicando...">
          <Copy className="h-4 w-4" aria-hidden="true" />
          Duplicar evento
        </Button>
      </div>
    </div>
  );
}
