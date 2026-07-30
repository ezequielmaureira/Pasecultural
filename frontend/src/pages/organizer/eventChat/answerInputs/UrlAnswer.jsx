import { useState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { inputClass } from "../../../../components/ui/FormField.jsx";
import { getSocialNetworkIcon } from "../../../../lib/socialNetworkIcons.js";

// `network` es el id elegido en el paso SOCIAL_NETWORK anterior (recordado
// por ConversationView sólo para elegir el ícono correcto acá — no afecta
// la navegación ni se manda de vuelta al backend).
export default function UrlAnswer({ onSubmit, disabled, network, currentValue }) {
  const [value, setValue] = useState(currentValue ?? "");
  const Icon = network ? getSocialNetworkIcon(network) : Link2;

  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !disabled) onSubmit(value.trim());
      }}
    >
      <div className="relative w-full">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-400" />
        <input
          autoFocus
          type="url"
          className={`${inputClass} pl-9`}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://..."
        />
      </div>
      <Button type="submit" disabled={disabled || !value.trim()}>
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
