import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import ScheduleRowsEditor, {
  emptyScheduleRow,
  rowsAreSubmittable,
} from "../../../../components/ui/ScheduleRowsEditor.jsx";

// Uno o varios horarios para la misma recurrencia (ej. Viernes/Sábado con
// funciones a las 18:00 y a las 21:00): mismo editor de filas que el
// Administrador de Agenda, sólo que sin fecha. El motor cruza cada horario
// cargado acá con cada día que matchea el rango + días de semana elegidos.
export default function FunctionsRecurringSchedulesAnswer({ onSubmit, disabled }) {
  const [rows, setRows] = useState(() => [emptyScheduleRow(false)]);

  const canSubmit = rowsAreSubmittable(rows, false);

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit(rows.map(({ startTime, endTime }) => ({ startTime, endTime })));
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <ScheduleRowsEditor
        rows={rows}
        onChange={setRows}
        withDate={false}
        addLabel="Agregar horario"
        disabled={disabled}
      />

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
