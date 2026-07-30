import Spinner from "./Spinner.jsx";

// Overlay bloqueante reutilizable para operaciones asincronas "pesadas"
// (publicar, procesar un pago, etc.) donde dejar el boton solo en estado
// de carga no alcanza: se tapa toda la interfaz para evitar acciones
// duplicadas mientras se resuelve. `open` controla el montaje; el propio
// llamador decide cuando pasarlo a `false` (al resolver o fallar la
// promesa), este componente no tiene lógica propia de negocio.
export default function LoadingOverlay({ open, title, message }) {
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      className="overlay-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="modal-pop-in flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#0B1120] px-8 py-10 text-center shadow-2xl shadow-black/50">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 animate-pulse rounded-full bg-violet-500/20 blur-lg" />
          <Spinner size="xl" />
        </div>

        {title && <p className="text-base font-bold text-white">{title}</p>}
        {message && <p className="text-sm text-slate-400">{message}</p>}
      </div>
    </div>
  );
}
