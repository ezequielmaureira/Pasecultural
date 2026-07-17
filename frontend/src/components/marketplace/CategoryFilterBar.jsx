import { MARKETPLACE_CATEGORIES } from "../../lib/eventCategories.js";

export default function CategoryFilterBar({ value, onChange, className = "" }) {
  return (
    <div className={`flex gap-3 overflow-x-auto pb-1 ${className}`}>
      {MARKETPLACE_CATEGORIES.map(({ id, label, icon: Icon }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex shrink-0 flex-col items-center gap-2 rounded-xl border px-6 py-4 text-xs font-medium transition-colors duration-150 ${
              isActive
                ? "border-violet-500 bg-violet-500/10 text-white"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? "text-violet-400" : "text-slate-400"}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
