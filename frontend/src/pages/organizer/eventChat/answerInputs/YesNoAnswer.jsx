import { Check, X } from "lucide-react";

export default function YesNoAnswer({ onSubmit, disabled }) {
  return (
    <div className="flex w-full items-center justify-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit(true)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors duration-150 hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check className="h-4 w-4 text-emerald-400" />
        Sí
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit(false)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors duration-150 hover:border-rose-500/60 hover:bg-rose-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-4 w-4 text-rose-400" />
        No
      </button>
    </div>
  );
}
