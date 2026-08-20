// Badge genérico por tono — consolida los distintos Pill/StatusBadge que
// hoy viven duplicados e inline en OrganizerDashboard.jsx, OrganizerEvents.jsx
// y OrganizerScanners.jsx (no se tocan esos archivos en esta iteración; este
// componente es el punto de partida para pantallas nuevas).
const TONE_CLASSES = {
  neutral: "bg-white/10 text-slate-300",
  success: "bg-emerald-500/10 text-emerald-400",
  warning: "bg-amber-500/10 text-amber-400",
  danger: "bg-rose-500/10 text-rose-400",
  info: "bg-sky-500/10 text-sky-400",
};

export default function Badge({ tone = "neutral", children, className = "", ...rest }) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        TONE_CLASSES[tone] ?? TONE_CLASSES.neutral
      } ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
