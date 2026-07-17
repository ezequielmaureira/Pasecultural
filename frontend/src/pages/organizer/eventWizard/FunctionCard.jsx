import { Info, Trash2 } from "lucide-react";
import Accordion from "../../../components/ui/Accordion.jsx";
import { Field, inputClass } from "../../../components/ui/FormField.jsx";
import { FUNCTION_STATUS_LABEL } from "../../../lib/functionStatus.js";

function OverrideRow({ label, useCatalog, catalogValue, overrideValue, onToggle, onOverrideChange }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={useCatalog}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-violet-600"
        />
        Usar {label} del catálogo ({catalogValue})
      </label>

      {!useCatalog && (
        <input
          type="number"
          min={0}
          className={`${inputClass} h-9`}
          value={overrideValue}
          onChange={(e) => onOverrideChange(e.target.value)}
          placeholder={`${label} para esta función`}
        />
      )}
    </div>
  );
}

export default function FunctionCard({
  fn,
  index,
  catalog,
  expanded,
  onToggle,
  onChange,
  onAssignmentChange,
  onRemove,
  canRemove,
}) {
  return (
    <Accordion
      expanded={expanded}
      onToggle={onToggle}
      title={`Función ${index + 1}`}
      subtitle={
        fn.date
          ? `${fn.date}${fn.startTime ? ` · ${fn.startTime}hs` : ""}${fn.venue ? ` · ${fn.venue}` : ""}`
          : "Sin fecha"
      }
      actions={
        canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )
      }
    >
      {fn.copiedFromPrevious && (
        <div className="flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3 text-violet-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs">
            La nueva función fue creada copiando la anterior. Modificá solamente los datos que
            cambien.
          </p>
        </div>
      )}

      <Field label="Fecha">
        <input
          type="date"
          className={inputClass}
          value={fn.date}
          onChange={(e) => onChange("date", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Hora de apertura">
          <input
            type="time"
            className={inputClass}
            value={fn.doorsOpenTime}
            onChange={(e) => onChange("doorsOpenTime", e.target.value)}
          />
        </Field>
        <Field label="Hora de inicio">
          <input
            type="time"
            className={inputClass}
            value={fn.startTime}
            onChange={(e) => onChange("startTime", e.target.value)}
          />
        </Field>
        <Field label="Hora de finalización">
          <input
            type="time"
            className={inputClass}
            value={fn.endTime}
            onChange={(e) => onChange("endTime", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Lugar">
        <input
          className={inputClass}
          value={fn.venue}
          onChange={(e) => onChange("venue", e.target.value)}
          placeholder="Ej: Teatro del Libertador"
        />
      </Field>

      <Field label="Dirección (opcional)">
        <input
          className={inputClass}
          value={fn.address}
          onChange={(e) => onChange("address", e.target.value)}
          placeholder="Calle y número"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Capacidad (opcional)">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={fn.capacity}
            onChange={(e) => onChange("capacity", e.target.value)}
          />
        </Field>
        <Field label="Estado">
          <select
            className={inputClass}
            value={fn.status}
            onChange={(e) => onChange("status", e.target.value)}
          >
            {Object.entries(FUNCTION_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value} className="bg-[#0B1120]">
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Entradas de esta función
        </p>

        {catalog.map((tt, ticketIndex) => {
          const assignment = fn.ticketAssignments[ticketIndex];
          if (!assignment) return null;

          return (
            <div
              key={tt._key}
              className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#0B1120] p-4"
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={assignment.enabled}
                  onChange={(e) => onAssignmentChange(ticketIndex, { enabled: e.target.checked })}
                  className="accent-violet-600"
                />
                <span className="text-sm font-medium text-white">{tt.name || "Entrada"}</span>
              </label>

              {assignment.enabled && (
                <div className="flex flex-col gap-2 pl-6">
                  <OverrideRow
                    label="precio"
                    catalogValue={tt.price || 0}
                    useCatalog={assignment.useCatalogPrice}
                    overrideValue={assignment.priceOverride}
                    onToggle={(checked) => onAssignmentChange(ticketIndex, { useCatalogPrice: checked })}
                    onOverrideChange={(value) =>
                      onAssignmentChange(ticketIndex, { priceOverride: value })
                    }
                  />
                  <OverrideRow
                    label="cantidad"
                    catalogValue={tt.quantity || 0}
                    useCatalog={assignment.useCatalogQuantity}
                    overrideValue={assignment.quantityOverride}
                    onToggle={(checked) =>
                      onAssignmentChange(ticketIndex, { useCatalogQuantity: checked })
                    }
                    onOverrideChange={(value) =>
                      onAssignmentChange(ticketIndex, { quantityOverride: value })
                    }
                  />

                  <div className="flex flex-col gap-2 rounded-lg border border-white/10 p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={assignment.useCatalogVisible}
                        onChange={(e) =>
                          onAssignmentChange(ticketIndex, { useCatalogVisible: e.target.checked })
                        }
                        className="accent-violet-600"
                      />
                      Usar visibilidad del catálogo ({tt.visible ? "Visible" : "Oculta"})
                    </label>

                    {!assignment.useCatalogVisible && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onAssignmentChange(ticketIndex, { visibleOverride: true })}
                          className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${
                            assignment.visibleOverride
                              ? "bg-violet-600 text-white"
                              : "bg-white/5 text-slate-400 hover:bg-white/10"
                          }`}
                        >
                          Visible
                        </button>
                        <button
                          type="button"
                          onClick={() => onAssignmentChange(ticketIndex, { visibleOverride: false })}
                          className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${
                            !assignment.visibleOverride
                              ? "bg-violet-600 text-white"
                              : "bg-white/5 text-slate-400 hover:bg-white/10"
                          }`}
                        >
                          Oculta
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Accordion>
  );
}
