import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pila de modales montados (más de uno puede estar abierto a la vez, ej.
// detalle de entrada + QR apilados en Mis Entradas): sólo el que está en la
// punta de la pila reacciona a Escape/Tab. Sin esto, Escape cerraría todos
// los modales abiertos de una — no sólo el de arriba — y el trap de foco de
// uno interferiría con el del otro. Alcanza con un array a nivel de módulo:
// sólo se lee/escribe de forma síncrona dentro de los propios handlers de
// evento, no hace falta Context ni estado reactivo para esto.
const modalStack = [];

export default function Modal({ title, onClose, children, maxWidth = "max-w-md" }) {
  // useId (no un literal fijo) porque puede haber más de un <Modal/> montado
  // a la vez — un id repetido rompe aria-labelledby para uno de los dos.
  const titleId = useId();
  const instanceId = useId();
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const onCloseRef = useRef(onClose);

  // onClose casi siempre es una arrow function nueva en cada render del
  // padre — si el efecto de abajo dependiera de `onClose` directamente, se
  // re-ejecutaría en cada re-render (re-robando el foco al medio de una
  // interacción). Se guarda en un ref y el efecto de setup corre una sola
  // vez por apertura/cierre real del modal.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    modalStack.push(instanceId);
    previouslyFocusedRef.current = document.activeElement;

    const dialogNode = dialogRef.current;
    const focusables = () => Array.from(dialogNode.querySelectorAll(FOCUSABLE_SELECTOR));
    (focusables()[0] ?? dialogNode)?.focus();

    function isTopmost() {
      return modalStack[modalStack.length - 1] === instanceId;
    }

    function handleKeyDown(event) {
      if (!isTopmost()) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = modalStack.indexOf(instanceId);
      if (index !== -1) modalStack.splice(index, 1);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-xl border border-white/10 bg-[#0B1120] p-6 outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 light:border-slate-200 light:bg-white`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-sm font-semibold text-white light:text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-400 transition-colors duration-150 hover:text-white light:hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
