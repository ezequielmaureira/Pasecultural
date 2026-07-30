import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICON_BY_TYPE = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const TONE_BY_TYPE = {
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  info: "border-violet-500/20 bg-violet-500/10 text-violet-300",
};

const DEFAULT_DURATION = 4000;

// Toast/snackbar global reutilizable: cualquier pantalla puede confirmar
// éxito/error/info sin resolver su propio mensaje inline. Se apila en la
// esquina inferior derecha y cada toast se autodescarta solo.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message, { type = "info", duration = DEFAULT_DURATION } = {}) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const api = useRef({
    success: (message, opts) => show(message, { ...opts, type: "success" }),
    error: (message, opts) => show(message, { ...opts, type: "error" }),
    info: (message, opts) => show(message, { ...opts, type: "info" }),
    dismiss,
  }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((toast) => {
          const Icon = ICON_BY_TYPE[toast.type] ?? Info;
          return (
            <div
              key={toast.id}
              className={`toast-slide-in pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-sm ${TONE_BY_TYPE[toast.type]}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-sm font-medium">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
                aria-label="Cerrar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
