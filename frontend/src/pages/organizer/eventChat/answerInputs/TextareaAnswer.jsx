import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { textareaClass } from "../../../../components/ui/FormField.jsx";

export default function TextareaAnswer({ onSubmit, disabled }) {
  const [value, setValue] = useState("");

  function submit() {
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
  }

  return (
    <form
      className="flex w-full flex-col items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        autoFocus
        className={`${textareaClass} h-32`}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Escribí tu respuesta..."
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
