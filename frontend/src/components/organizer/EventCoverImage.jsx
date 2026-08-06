// Extraído de EventHeroCard/EventStatusCard, que repetían exactamente el
// mismo bloque (imagen de portada + fallback en degradé con ícono) con sólo
// el tamaño distinto. `className` controla alto/ancho/radio desde cada
// caller — no pierde flexibilidad, sólo saca la duplicación.
export default function EventCoverImage({ src, icon: Icon, className = "", iconClassName = "h-8 w-8" }) {
  return (
    <div
      className={`shrink-0 bg-slate-900 bg-cover bg-center ${className}`}
      style={src ? { backgroundImage: `url(${src})` } : undefined}
    >
      {!src && (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/25 to-slate-900">
          <Icon className={`text-white/30 ${iconClassName}`} />
        </div>
      )}
    </div>
  );
}
