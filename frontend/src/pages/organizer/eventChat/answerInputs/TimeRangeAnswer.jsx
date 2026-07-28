import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import TimePicker from "../../../../components/ui/TimePicker.jsx";
import { Field } from "../../../../components/ui/FormField.jsx";

export default function TimeRangeAnswer({ onSubmit, disabled }) {
  const [startTime, setStartTime] = useState("21:00");
  const [endTime, setEndTime] = useState("");

  const canSubmit = startTime && endTime;

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit({ startTime, endTime });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora de inicio">
          <TimePicker value={startTime} onChange={setStartTime} />
        </Field>
        <Field label="Hora de fin">
          <TimePicker value={endTime} onChange={setEndTime} />
        </Field>
      </div>

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
