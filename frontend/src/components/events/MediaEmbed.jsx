// Reproductor embebido para un enlace de video (por ahora solo YouTube).
// No muestra ningún botón: el player va directo, en 16:9 responsive.
// Solo consume el resultado de MediaParser (embedUrl); no detecta nada acá.
export default function MediaEmbed({ embedUrl, title }) {
  if (!embedUrl) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10 shadow-lg shadow-black/30">
        <iframe
          src={embedUrl}
          title={title || "Video"}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
      {title && <p className="px-0.5 text-sm text-slate-300">{title}</p>}
    </div>
  );
}
