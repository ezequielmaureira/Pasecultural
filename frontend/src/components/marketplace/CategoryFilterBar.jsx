import { MARKETPLACE_CATEGORIES } from "../../lib/eventCategories.js";

export default function CategoryFilterBar({ value, onChange, className = "" }) {
  return (
    <div
      className={`no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-1 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:snap-none sm:pb-0 ${className}`}
    >
      {MARKETPLACE_CATEGORIES.map(({ id, label, icon: Icon }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex shrink-0 snap-start flex-col items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium transition-colors duration-150 sm:px-6 sm:py-4 ${
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
