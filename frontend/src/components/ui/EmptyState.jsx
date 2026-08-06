// Extraído de PanelEmptyState (antes local y no exportado en
// OrganizerDashboard.jsx) para poder reutilizarlo en cualquier panel nuevo
// (ventas, timeline de actividad, ingresos) sin redefinirlo cada vez.
export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      {Icon && <Icon className="h-6 w-6 text-slate-600" />}
      {title && <p className="text-sm font-medium text-slate-300">{title}</p>}
      {children && <p className="text-sm text-slate-500">{children}</p>}
      {action}
    </div>
  );
}
