// Extraído de PanelEmptyState (antes local y no exportado en
// OrganizerDashboard.jsx) para poder reutilizarlo en cualquier panel nuevo
// (ventas, timeline de actividad, ingresos) sin redefinirlo cada vez. El
// ícono va sobre un fondo circular (mismo tratamiento que ya tenía el
// empty-state a mano de OrganizerSales.jsx antes de esta iteración) en vez
// de flotar suelto — se ve más intencional, no más recargado.
export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
          <Icon className="h-6 w-6 text-slate-500" aria-hidden="true" />
        </div>
      )}
      {title && <p className="text-sm font-medium text-slate-300">{title}</p>}
      {children && <p className="max-w-xs text-sm text-slate-500">{children}</p>}
      {action}
    </div>
  );
}
