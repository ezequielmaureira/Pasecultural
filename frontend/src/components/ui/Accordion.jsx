import { ChevronDown } from "lucide-react";

export default function Accordion({
  expanded,
  onToggle,
  title,
  subtitle,
  actions,
  children,
  className = "",
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-white/10 bg-white/5 ${className}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions && (
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform duration-150 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      {expanded && <div className="flex flex-col gap-3 border-t border-white/10 p-4">{children}</div>}
    </div>
  );
}
