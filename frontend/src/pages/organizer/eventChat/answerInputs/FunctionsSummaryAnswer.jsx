import { Check, Pencil, ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }).replace(".", "");
}

export default function FunctionsSummaryAnswer({ onSubmit, disabled, functions }) {
  const list = functions ?? [];

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-semibold text-white">Funciones creadas</p>
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {list.map((fn, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              {formatDate(fn.date)} {fn.startTime} - {fn.endTime}
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs font-medium text-slate-500">Total: {list.length} funciones</p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => onSubmit("EDIT")}
        >
          <Pencil className="h-4 w-4" />
          Editar funciones
        </Button>
        <Button type="button" disabled={disabled} onClick={() => onSubmit("CONTINUE")}>
          Continuar
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
