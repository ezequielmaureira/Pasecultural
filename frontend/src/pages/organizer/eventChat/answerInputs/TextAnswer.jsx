import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { inputClass } from "../../../../components/ui/FormField.jsx";

export default function TextAnswer({ onSubmit, disabled, currentValue }) {
  const [value, setValue] = useState(currentValue ?? "");

  function submit() {
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
  }

  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        autoFocus
        type="text"
        className={inputClass}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Escribí tu respuesta..."
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
