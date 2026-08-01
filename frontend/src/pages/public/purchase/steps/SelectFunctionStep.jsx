import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";
import { formatEventDateTime } from "../../../../lib/eventFormat.js";

export default function SelectFunctionStep({ functions, selectedFunctionId, onSelect, onContinue }) {
  return (
    <Card>
      <div className="flex flex-col gap-1 pb-4 text-center">
        <h2 className="text-lg font-bold text-white">Elegí la función</h2>
        <p className="text-sm text-slate-400">Seleccioná la fecha y hora del evento</p>
      </div>

      <div className="flex flex-col gap-2">
        {functions.map((fn) => {
          const selected = fn.id === selectedFunctionId;
          return (
            <button
              key={fn.id}
              type="button"
              onClick={() => onSelect(fn.id)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                selected ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-violet-400" : "border-white/20"
                }`}
              >
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-violet-400" />}
              </span>
              <span className="text-sm font-medium text-white">{formatEventDateTime(fn.date)}</span>
            </button>
          );
        })}
      </div>

      <Button
        className="mt-6 w-full justify-center"
        disabled={!selectedFunctionId}
        onClick={onContinue}
      >
        Continuar
      </Button>
    </Card>
  );
}
