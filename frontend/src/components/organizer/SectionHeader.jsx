// Estandariza el encabezado de cada sección del Dashboard (título + acción
// opcional, ej. "Ver todos") — antes "Estado de mis eventos" armaba este
// bloque a mano y "Últimas ventas" usaba el título interno de Card, con dos
// tratamientos visuales distintos para el mismo rol. Genérico: cualquier
// sección nueva (Iteración 1+) lo puede usar sin redefinirlo.
export default function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        {Icon && <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />}
        {title}
      </h2>
      {action}
    </div>
  );
}
