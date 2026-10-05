import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { inputClass } from "../ui/FormField.jsx";

// Confirmación escrita compartida por "Eliminar organización"
// (OrganizerSettings) y "Eliminar mi cuenta" (Profile). El backend exige la
// misma palabra en el body — esto es sólo la mitad visible de esa regla.
export const DELETE_CONFIRMATION_WORD = "ELIMINAR";

const DANGER_BUTTON_CLASS =
  "inline-flex h-11 w-full items-center justify-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

const DANGER_OUTLINE_BUTTON_CLASS =
  "inline-flex h-11 w-full items-center justify-center rounded-lg border border-rose-500/40 px-4 text-sm font-semibold text-rose-300 transition-colors duration-150 hover:bg-rose-500/10 light:text-rose-600 sm:w-auto";

// Card "Zona de peligro": separada visualmente del resto de la pantalla (y
// de cualquier botón Guardar), con una única acción que sólo abre el modal
// de confirmación — nunca ejecuta nada por sí misma.
export function DangerZoneCard({ actionTitle, description, buttonLabel, onRequest }) {
  return (
    <section
      aria-labelledby="danger-zone-title"
      className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 sm:p-6 light:border-rose-200 light:bg-rose-50"
    >
      <h2 id="danger-zone-title" className="flex items-center gap-2 text-base font-semibold text-rose-300 light:text-rose-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Zona de peligro
      </h2>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white light:text-slate-900">{actionTitle}</p>
          <p className="mt-1 text-sm text-slate-400 light:text-slate-600">{description}</p>
        </div>
        <button type="button" onClick={onRequest} className={`${DANGER_OUTLINE_BUTTON_CLASS} shrink-0`}>
          {buttonLabel}
        </button>
      </div>
    </section>
  );
}

// Modal con confirmación escrita: el botón destructivo queda deshabilitado
// hasta que el input sea exactamente ELIMINAR. `onConfirm` recibe la
// palabra tipeada (la que viaja al backend) y puede lanzar — el mensaje del
// error se muestra dentro del modal.
export function TypedConfirmModal({ title, paragraphs, confirmLabel, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const matches = typed === DELETE_CONFIRMATION_WORD;

  async function handleConfirm(e) {
    e.preventDefault();
    if (!matches || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(typed);
    } catch (err) {
      setError(err.message || "No se pudo completar la acción.");
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={submitting ? () => {} : onClose}>
      <form onSubmit={handleConfirm} className="flex flex-col gap-4">
        {paragraphs.map((text) => (
          <p key={text} className="text-sm text-slate-300 light:text-slate-700">
            {text}
          </p>
        ))}

        <label className="flex flex-col gap-1.5 text-sm text-slate-300 light:text-slate-700">
          Escribí {DELETE_CONFIRMATION_WORD} para confirmar
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={inputClass}
            placeholder={DELETE_CONFIRMATION_WORD}
            disabled={submitting}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-rose-400">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-white/10 px-4 text-sm font-medium text-gray-100 transition-colors duration-150 hover:bg-white/15 disabled:opacity-50 light:bg-slate-900/5 light:text-slate-900 sm:w-auto"
          >
            Cancelar
          </button>
          <button type="submit" disabled={!matches || submitting} className={DANGER_BUTTON_CLASS}>
            {submitting ? "Eliminando..." : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
