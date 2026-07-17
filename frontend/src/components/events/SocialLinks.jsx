import { getEventLinkIcon, getEventLinkLabel } from "../../lib/eventLinkTypes.js";

// Enlaces no embebibles del evento (Instagram, Facebook, TikTok, Spotify,
// WhatsApp, Página Web, Otro), mostrados como botones con su ícono. Los
// enlaces embebibles (YouTube) se muestran con <MediaEmbed />, no acá.
// Reutilizable entre la vista previa del wizard y la página pública del evento.
export default function SocialLinks({ links, title = "Conocé más" }) {
  const visibleLinks = (links ?? []).filter((link) => link.url && !link.isEmbeddable);
  if (visibleLinks.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {title && <p className="text-sm font-semibold text-white">{title}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visibleLinks.map((link, index) => {
          const Icon = getEventLinkIcon(link.type);
          return (
            <a
              key={`${link.url}-${index}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 transition-colors duration-150 hover:border-violet-500/40 hover:bg-white/10"
            >
              <Icon className="h-4 w-4 shrink-0 text-violet-400" />
              <span className="truncate text-sm text-slate-200">
                {link.title?.trim() || getEventLinkLabel(link.type)}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
