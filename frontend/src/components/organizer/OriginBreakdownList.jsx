// Lista "💰 Vendidas ... 520 / 🎁 Cortesías ... 38" bajo "Entradas
// emitidas" — recibe filas ya armadas por
// functionStatsSelectors.js#buildIssuedByOriginBreakdown (emoji/label
// vienen de lib/ticketOrigin.js, la misma fuente que usa el Scanner). Sin
// filas no renderiza nada (evento sin entradas emitidas todavía).
export default function OriginBreakdownList({ breakdown }) {
  if (!breakdown || breakdown.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-1.5 text-sm">
      {breakdown.map((row) => (
        <li key={row.origin} className="flex items-center justify-between gap-3 text-slate-300">
          <span className="flex items-center gap-1.5 truncate">
            <span aria-hidden="true">{row.emoji}</span>
            {row.pluralLabel}
          </span>
          <span className="font-semibold text-white">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}
