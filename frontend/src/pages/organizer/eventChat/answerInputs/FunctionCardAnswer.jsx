import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import DatePicker from "../../../../components/ui/DatePicker.jsx";
import TimePicker from "../../../../components/ui/TimePicker.jsx";
import { Field } from "../../../../components/ui/FormField.jsx";

// Una función completa (fecha + hora de inicio + hora de fin) en una sola
// tarjeta: se siente como una única respuesta dentro del chat, no como tres
// preguntas separadas ni como un formulario administrativo aparte.
export default function FunctionCardAnswer({ onSubmit, disabled, currentValue }) {
  const [date, setDate] = useState(currentValue?.date ?? "");
  const [startTime, setStartTime] = useState(currentValue?.startTime ?? "21:00");
  const [endTime, setEndTime] = useState(currentValue?.endTime ?? "");

  const canSubmit = date && startTime && endTime;

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit({ date, startTime, endTime });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <Field label="Fecha">
        <DatePicker value={date} onChange={setDate} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora de inicio">
          <TimePicker value={startTime} onChange={setStartTime} />
        </Field>
        <Field label="Hora de fin">
          <TimePicker value={endTime} onChange={setEndTime} />
        </Field>
      </div>

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="w-full self-stretch sm:w-auto sm:self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
