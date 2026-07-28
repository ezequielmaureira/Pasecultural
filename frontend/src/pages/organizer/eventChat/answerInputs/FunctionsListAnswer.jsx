import { useState } from "react";
import { ArrowRight, Check, Pencil, Plus, Trash2 } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import DatePicker from "../../../../components/ui/DatePicker.jsx";
import TimePicker from "../../../../components/ui/TimePicker.jsx";
import { toIsoDate } from "../../../../lib/dateGrid.js";

let rowKeyCounter = 0;
function rowKey() {
  rowKeyCounter += 1;
  return `row-${Date.now()}-${rowKeyCounter}`;
}

function toRow(slot) {
  return {
    _key: rowKey(),
    date: slot.date ? toIsoDate(new Date(slot.date)) : "",
    startTime: slot.startTime ?? "21:00",
    endTime: slot.endTime ?? "",
    editing: false,
  };
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// "Administrador de funciones": agregar, editar y quitar filas de fecha +
// horario sin repetir el flujo pregunta-por-pregunta. Se usa tanto para
// "varias funciones" (arranca vacío) como para revisar "funciones
// recurrentes" (arranca precargado) y para "Editar funciones" desde el
// resumen (arranca con lo que ya estaba cargado).
export default function FunctionsListAnswer({ onSubmit, disabled, slots }) {
  const [rows, setRows] = useState(() => (slots ?? []).map(toRow));

  function addRow() {
    setRows((prev) => [...prev, { _key: rowKey(), date: "", startTime: "21:00", endTime: "", editing: true }]);
  }

  function removeRow(key) {
    setRows((prev) => prev.filter((r) => r._key !== key));
  }

  function updateRow(key, patch) {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }

  function toggleEdit(key) {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, editing: !r.editing } : r)));
  }

  const hasIncompleteRow = rows.some((r) => r.editing || !r.date || !r.startTime || !r.endTime);
  const canSubmit = rows.length > 0 && !hasIncompleteRow;

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit(rows.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })));
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((row) =>
          row.editing ? (
            <div
              key={row._key}
              className="flex flex-col gap-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 sm:flex-row sm:items-end"
            >
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                <DatePicker
                  value={row.date}
                  onChange={(value) => updateRow(row._key, { date: value })}
                  placeholder="Fecha"
                />
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
                disabled={!row.date || !row.startTime || !row.endTime}
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
                {formatDate(row.date)}
                <span className="ml-2 text-slate-400">
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
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={addRow}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 transition-colors duration-150 hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed"
      >
        <Plus className="h-4 w-4" />
        Agregar función
      </button>

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
