import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Field, inputClass } from "../../../components/ui/FormField.jsx";
import { getEventLinkLabel } from "../../../lib/eventLinkTypes.js";

function HelpText({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>;
}

export default function EventLinksEditor({ links, onAdd, onRemove, onChange }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-white">Paso 2 · Enlaces del Evento</p>
        <HelpText>
          Pegá la URL de una red social, un video de YouTube, Spotify, la página oficial o
          cualquier otro enlace relacionado con el evento. Detectamos automáticamente de qué se
          trata.
        </HelpText>
      </div>

      {links.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/15 p-4 text-center text-xs text-slate-500">
          Todavía no agregaste ningún enlace. Es opcional: podés continuar sin cargar ninguno.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {links.map((link, index) => (
          <div
            key={link._key}
            className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#0B1120] p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Enlace {index + 1}
              </p>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="text-slate-500 hover:text-rose-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <Field label="URL">
              <input
                className={inputClass}
                value={link.url}
                onChange={(e) => onChange(index, "url", e.target.value)}
                placeholder="https://instagram.com/artista, https://youtu.be/..., https://open.spotify.com/..."
              />
              {link.error ? (
                <p className="mt-1 text-xs text-rose-400">{link.error}</p>
              ) : (
                link.url.trim() &&
                link.type && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Detectamos: {getEventLinkLabel(link.type)}
                  </p>
                )
              )}
            </Field>

            <Field label="Título (opcional)">
              <input
                className={inputClass}
                value={link.title}
                onChange={(e) => onChange(index, "title", e.target.value)}
                placeholder="Ej: Video promocional"
              />
            </Field>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 hover:border-violet-500/60 hover:text-violet-300"
      >
        <Plus className="h-4 w-4" />
        Agregar enlace
      </button>
    </div>
  );
}
