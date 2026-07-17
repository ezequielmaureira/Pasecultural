import { Plus, Trash2 } from "lucide-react";
import { Field, inputClass } from "../../../components/ui/FormField.jsx";

function HelpText({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>;
}

export default function TicketCatalogEditor({ catalog, onAdd, onRemove, onChange }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-white">Paso 2 · Catálogo de entradas</p>
        <p className="text-xs text-slate-500">
          Creá las entradas una sola vez para todo el evento. Después elegís, dentro de cada
          función, cuáles vas a usar.
        </p>
      </div>

      <HelpText>Ejemplos: General, VIP, Platea, Campo, Preferencial, Pullman o Invitación.</HelpText>

      <div className="flex flex-col gap-3">
        {catalog.map((tt, index) => (
          <div
            key={tt._key}
            className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#0B1120] p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Entrada {index + 1}
              </p>
              {catalog.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nombre">
                <input
                  className={inputClass}
                  value={tt.name}
                  onChange={(e) => onChange(index, "name", e.target.value)}
                  placeholder="Ej: General"
                />
              </Field>
              <Field label="Precio">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  value={tt.price}
                  onChange={(e) => onChange(index, "price", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Cantidad disponible">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={tt.quantity}
                  onChange={(e) => onChange(index, "quantity", e.target.value)}
                />
              </Field>
              <Field label="Máximo por compra">
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={tt.maxPerPurchase}
                  onChange={(e) => onChange(index, "maxPerPurchase", e.target.value)}
                />
              </Field>
            </div>

            <Field label="Descripción (opcional)">
              <input
                className={inputClass}
                value={tt.description}
                onChange={(e) => onChange(index, "description", e.target.value)}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-white/10 p-3">
              <p className="text-sm text-slate-300">Visible al público</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(index, "visible", true)}
                  className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${
                    tt.visible
                      ? "bg-violet-600 text-white"
                      : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  Sí
                </button>
                <button
                  type="button"
                  onClick={() => onChange(index, "visible", false)}
                  className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${
                    !tt.visible
                      ? "bg-violet-600 text-white"
                      : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  No
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 hover:border-violet-500/60 hover:text-violet-300"
      >
        <Plus className="h-4 w-4" />
        Agregar entrada
      </button>
    </div>
  );
}
