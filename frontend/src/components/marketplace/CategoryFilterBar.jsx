import { MARKETPLACE_CATEGORIES } from "../../lib/eventCategories.js";

export default function CategoryFilterBar({ value, onChange, className = "" }) {
  return (
    <div
      className={`no-scrollbar flex min-w-0 flex-nowrap snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] sm:gap-3 ${className}`}
    >
      {MARKETPLACE_CATEGORIES.map(({ id, label, icon: Icon }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex shrink-0 snap-start flex-col items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium backdrop-blur-sm transition-all duration-150 sm:px-6 sm:py-4 ${
              isActive
                ? "smarticket-neon-chip-active border-lime-500 bg-lime-500/10 text-white light:text-slate-900"
                : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white light:border-slate-200 light:bg-slate-900/[0.03] light:text-slate-600 light:hover:bg-slate-900/5 light:hover:text-slate-900"
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? "text-lime-400" : "text-slate-400"}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
