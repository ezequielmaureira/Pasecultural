import { AlertTriangle } from "lucide-react";

// Estado de error genérico — hoy una carga fallida en OrganizerDataContext
// sólo se logueaba en consola y quedaba indistinguible de "no hay datos
// todavía". Este componente es el punto de entrada para mostrarlo de verdad
// en cualquier pantalla que lo necesite, con un reintento explícito en vez
// de forzar un refresh completo de la página.
export default function InlineErrorNotice({ message = "No pudimos cargar esta información.", onRetry }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-5 text-center">
      <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden="true" />
      <p className="text-sm text-rose-300">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-xs font-medium text-rose-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070B]"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
