import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import { inputClass } from "../../../../components/ui/FormField.jsx";
import { isValidHttpUrl, parseMediaUrl } from "../../../../utils/mediaParser.js";

// La validación real (que sea YouTube y tenga un video válido) la hace el
// backend (backend/src/conversation/inputHandlers/youtubeUrl.js). Acá sólo
// se usa MediaParser para mostrar un preview inmediato, nunca para bloquear
// el submit por su cuenta.
export default function YoutubeAnswer({ onSubmit, disabled, currentValue }) {
  const [value, setValue] = useState(currentValue ?? "");

  const embedUrl = useMemo(() => {
    if (!isValidHttpUrl(value)) return null;
    try {
      const { platform, embedUrl: url } = parseMediaUrl(value);
      return platform === "YOUTUBE" ? url : null;
    } catch {
      return null;
    }
  }, [value]);

  return (
    <form
      className="flex w-full flex-col items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !disabled) onSubmit(value.trim());
      }}
    >
      <div className="flex w-full items-center gap-2">
        <input
          autoFocus
          type="url"
          className={inputClass}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        <Button type="submit" disabled={disabled || !value.trim()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {embedUrl && (
        <div className="aspect-video w-full max-w-sm overflow-hidden rounded-xl border border-white/10">
          <iframe
            src={embedUrl}
            title="Preview del video"
            className="h-full w-full"
            allowFullScreen
          />
        </div>
      )}
    </form>
  );
}
