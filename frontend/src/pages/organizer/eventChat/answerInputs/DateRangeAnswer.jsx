import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import DatePicker from "../../../../components/ui/DatePicker.jsx";
import { Field } from "../../../../components/ui/FormField.jsx";

export default function DateRangeAnswer({ onSubmit, disabled, currentValue }) {
  const [from, setFrom] = useState(currentValue?.from ?? "");
  const [to, setTo] = useState(currentValue?.to ?? "");

  const canSubmit = from && to;

  function submit() {
    if (!canSubmit || disabled) return;
    onSubmit({ from, to });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="Hasta">
          <DatePicker value={to} onChange={setTo} />
        </Field>
      </div>

      <Button type="button" onClick={submit} disabled={disabled || !canSubmit} className="w-full self-stretch sm:w-auto sm:self-end">
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
