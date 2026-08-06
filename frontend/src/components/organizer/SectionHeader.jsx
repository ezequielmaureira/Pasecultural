// Estandariza el encabezado de cada sección (título + aclaración opcional +
// acción opcional, ej. "Ver todos") — antes "Estado de mis eventos" armaba
// este bloque a mano y "Últimas ventas" usaba el título interno de Card,
// con dos tratamientos visuales distintos para el mismo rol. Genérico:
// cualquier sección nueva lo puede usar sin redefinirlo.
//
// `subtitle` es opcional (no lo usa ninguna sección del Dashboard todavía)
// — para cuando el título solo no alcanza para aclarar el alcance de la
// sección, ej. "depende de los filtros aplicados arriba".
export default function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          {Icon && <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
