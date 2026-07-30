import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import ScheduleRowsEditor, {
  scheduleRowKey,
  rowsAreSubmittable,
} from "../../../../components/ui/ScheduleRowsEditor.jsx";
import { toIsoDate } from "../../../../lib/dateGrid.js";

function toRow(slot) {
  return {
    _key: scheduleRowKey(),
    date: slot.date ? toIsoDate(new Date(slot.date)) : "",
    startTime: slot.startTime ?? "21:00",
    endTime: slot.endTime ?? "",
    editing: false,
  };
}

// "Administrador de Agenda": agregar, editar y quitar funciones (fecha +
// horario) sin repetir el flujo pregunta-por-pregunta. Se usa tanto para
// "varias funciones" (arranca vacío) como para revisar lo que generó
// "funciones recurrentes" (arranca precargado, editable antes de confirmar)
// y para "Editar funciones" desde el resumen (arranca con lo ya cargado).
// `currentValue` (lo último confirmado, si se llegó acá con "Volver") gana
// por sobre `slots` (lo que trae el buffer del loop al entrar de nuevo por
// el flujo normal) — ambos representan la misma lista, pero currentValue es
// la versión más reciente que el usuario efectivamente aprobó.
export default function FunctionsListAnswer({ onSubmit, disabled, slots, currentValue }) {
  const [rows, setRows] = useState(() => (currentValue ?? slots ?? []).map(toRow));

  const canSubmit = rowsAreSubmittable(rows, true);

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit(rows.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })));
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <ScheduleRowsEditor rows={rows} onChange={setRows} withDate addLabel="Agregar función" disabled={disabled} />

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="w-full self-stretch sm:w-auto sm:self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
