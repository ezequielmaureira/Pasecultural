import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import DatePicker from "./DatePicker.jsx";
import TimePicker from "./TimePicker.jsx";

let rowKeyCounter = 0;
function rowKey() {
  rowKeyCounter += 1;
  return `row-${Date.now()}-${rowKeyCounter}`;
}

export function emptyScheduleRow(withDate) {
  return { _key: rowKey(), date: withDate ? "" : undefined, startTime: "21:00", endTime: "", editing: true };
}

export function scheduleRowKey() {
  return rowKey();
}

// Un componente que sólo lista/edita/borra "confirma" cuándo hay al menos
// una fila y ninguna quedó a mitad de completar/editar.
export function rowsAreSubmittable(rows, withDate = true) {
  if (rows.length === 0) return false;
  return rows.every((r) => !r.editing && (!withDate || r.date) && r.startTime && r.endTime);
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// Editor de filas reutilizado en cada lugar donde el organizador arma
// horarios: el Administrador de Agenda (con fecha) y la lista de horarios de
// "funciones recurrentes" (sin fecha, sólo inicio/fin). Misma lógica de
// agregar/editar/eliminar en los dos casos, para que "crear una función",
// "editar una función" y "agregar un horario recurrente" se sientan como la
// misma interacción en vez de tres componentes distintos.
export default function ScheduleRowsEditor({
  rows,
  onChange,
  withDate = true,
  addLabel = "Agregar",
  disabled = false,
}) {
  function addRow() {
    onChange([...rows, emptyScheduleRow(withDate)]);
  }

  function removeRow(key) {
    onChange(rows.filter((r) => r._key !== key));
  }

  function updateRow(key, patch) {
    onChange(rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }

  function toggleEdit(key) {
    onChange(rows.map((r) => (r._key === key ? { ...r, editing: !r.editing } : r)));
  }

  function isRowComplete(row) {
    return (!withDate || row.date) && row.startTime && row.endTime;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) =>
        row.editing ? (
          <div
            key={row._key}
            className="flex flex-col gap-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 sm:flex-row sm:items-end"
          >
            <div className={`grid flex-1 grid-cols-1 gap-2 ${withDate ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {withDate && (
                <DatePicker
                  value={row.date}
                  onChange={(value) => updateRow(row._key, { date: value })}
                  placeholder="Fecha"
                />
              )}
              <TimePicker
                value={row.startTime}
                onChange={(value) => updateRow(row._key, { startTime: value })}
                placeholder="Inicio"
              />
              <TimePicker
                value={row.endTime}
                onChange={(value) => updateRow(row._key, { endTime: value })}
                placeholder="Fin"
              />
            </div>
            <button
              type="button"
              disabled={!isRowComplete(row)}
              onClick={() => toggleEdit(row._key)}
              className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Guardar
            </button>
          </div>
        ) : (
          <div
            key={row._key}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <span className="text-sm text-slate-200">
              {withDate && formatDate(row.date)}
              <span className={withDate ? "ml-2 text-slate-400" : "text-slate-200"}>
                {row.startTime} → {row.endTime}
              </span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleEdit(row._key)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeRow(row._key)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors duration-150 hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={addRow}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 transition-colors duration-150 hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed"
      >
        <Plus className="h-4 w-4" />
        {addLabel}
      </button>
    </div>
  );
}
