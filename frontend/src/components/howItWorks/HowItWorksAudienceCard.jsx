import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { getPublicHowItWorksContent } from "../../lib/contentApi.js";

const TABS = [
  { key: "attendees", label: "Para asistentes" },
  { key: "organizers", label: "Para organizadores" },
  { key: "scanners", label: "Para scanners" },
];

// Card administrable de la página pública /como-funciona: tres pestañas
// (asistentes/organizadores/scanners), cada una mostrando UNA imagen
// completa configurada desde Developer > Contenido (ver
// DeveloperContent.jsx). El diseño y el contenido viven enteramente dentro
// de la imagen — acá nunca se reconstruye texto ni se superpone nada sobre
// ella.
export default function HowItWorksAudienceCard() {
  const [activeTab, setActiveTab] = useState("attendees");
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getPublicHowItWorksContent();
        if (!cancelled) setContent(data);
      } catch (err) {
        console.error("No se pudo cargar el contenido de ¿Cómo funciona?", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCard = content?.[activeTab];
  const hasImage = Boolean(activeCard?.active && activeCard?.imageUrl);

  return (
    <section className="mx-auto w-full max-w-[1600px] px-2 pt-4 pb-16 sm:px-4 lg:px-6">
      <div className="mx-auto grid w-full max-w-xl grid-cols-3 gap-1 rounded-full border border-white/10 bg-black/30 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-1.5 py-1.5 text-center text-[11px] font-medium leading-tight transition-all duration-150 sm:px-3 sm:text-sm ${
              activeTab === tab.key
                ? "bg-brand text-slate-950 shadow-md shadow-brand/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-brand/20 bg-[#111713]/90 p-1.5 sm:p-2">
        {loading ? (
          <div className="flex h-40 w-full animate-pulse items-center justify-center rounded-xl bg-black/20 text-sm text-slate-500">
            Cargando...
          </div>
        ) : error ? (
          <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl bg-black/20 text-slate-500">
            <ImageOff className="h-6 w-6" />
            <p className="text-sm">No pudimos cargar este contenido.</p>
          </div>
        ) : hasImage ? (
          <img
            src={activeCard.imageUrl}
            alt={TABS.find((tab) => tab.key === activeTab)?.label ?? ""}
            className="block w-full rounded-xl"
            style={{ height: "auto", objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-xl bg-black/20 text-sm text-slate-500">
            Contenido próximamente
          </div>
        )}
      </div>
    </section>
  );
}
