import { useId } from "react";
import { X } from "lucide-react";

export default function Modal({ title, onClose, children, maxWidth = "max-w-md" }) {
  // useId (no un literal fijo) porque puede haber más de un <Modal/> montado
  // a la vez (ej. detalle de entrada + QR apilados) — un id repetido rompe
  // aria-labelledby para uno de los dos.
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-xl border border-white/10 bg-[#0B1120] p-6`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-sm font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-400 transition-colors duration-150 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
