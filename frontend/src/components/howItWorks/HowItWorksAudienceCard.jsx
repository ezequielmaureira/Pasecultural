import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { getPublicHowItWorksContent } from "../../lib/contentApi.js";

const TABS = [
  { key: "attendees", label: "Para asistentes" },
  { key: "organizers", label: "Para organizadores" },
];

// Card administrable de la página pública /como-funciona: dos pestañas
// (asistentes/organizadores), cada una mostrando UNA imagen completa
// configurada desde Developer > Contenido (ver DeveloperContent.jsx). El
// diseño y el contenido viven enteramente dentro de la imagen — acá nunca
// se reconstruye texto ni se superpone nada sobre ella.
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
    <section className="mx-auto max-w-7xl px-6 py-16">
      <div className="mx-auto rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4 shadow-lg shadow-black/20 sm:p-6">
        <div className="mx-auto mb-6 flex w-fit max-w-full items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 sm:px-5 ${
                activeTab === tab.key
                  ? "bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-md shadow-violet-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-black/20">
          {loading ? (
            <div className="flex h-56 w-full animate-pulse items-center justify-center text-sm text-slate-500">
              Cargando...
            </div>
          ) : error ? (
            <div className="flex h-56 w-full flex-col items-center justify-center gap-2 text-slate-500">
              <ImageOff className="h-6 w-6" />
              <p className="text-sm">No pudimos cargar este contenido.</p>
            </div>
          ) : hasImage ? (
            <img
              src={activeCard.imageUrl}
              alt={TABS.find((tab) => tab.key === activeTab)?.label ?? ""}
              className="max-h-[520px] w-full object-contain"
            />
          ) : (
            <div className="flex h-56 w-full items-center justify-center text-sm text-slate-500">
              Contenido próximamente
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
