import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { inputClass } from "../../../../components/ui/FormField.jsx";

export default function NumberAnswer({ onSubmit, disabled, inputType }) {
  const [value, setValue] = useState("");
  const isPrice = inputType === "PRICE";

  function submit() {
    if (value === "" || disabled) return;
    onSubmit(Number(value));
  }

  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="relative w-full">
        {isPrice && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
        )}
        <input
          autoFocus
          type="number"
          min={0}
          step={isPrice ? "0.01" : "1"}
          className={`${inputClass} ${isPrice ? "pl-6" : ""}`}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isPrice ? "0" : "1"}
        />
      </div>
      <Button type="submit" disabled={disabled || value === ""}>
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
