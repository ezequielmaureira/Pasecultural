import { useRef, useState } from "react";
import AttendeesExplainer from "../explainers/AttendeesExplainer.jsx";
import OrganizersExplainer from "../explainers/OrganizersExplainer.jsx";
import ScannerExplainer from "../explainers/ScannerExplainer.jsx";

const TABS = [
  { key: "attendees", label: "Para asistentes", Panel: AttendeesExplainer },
  { key: "organizers", label: "Para organizadores", Panel: OrganizersExplainer },
  { key: "scanners", label: "Para scanners", Panel: ScannerExplainer },
];

// Pestañas de la página pública /como-funciona (asistentes/organizadores/
// scanners). Antes cada pestaña mostraba UNA imagen subida desde
// Developer > Contenido (content_cards + Cloudinary, hoy legacy sin uso);
// ahora cada una es una composición hecha en código
// (components/explainers/*) con los textos de data/explainersData.js.
export default function HowItWorksAudienceCard() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef([]);
  const { Panel, key } = TABS[activeIndex];

  function handleKeyDown(event) {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (activeIndex + moves[event.key] + TABS.length) % TABS.length;
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <div
        role="tablist"
        aria-label="¿Para quién es?"
        onKeyDown={handleKeyDown}
        className="mx-auto flex w-full max-w-xl gap-1 rounded-full border border-white/10 bg-black/30 p-1"
      >
        {TABS.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.key}
              ref={(node) => (tabRefs.current[index] = node)}
              type="button"
              role="tab"
              id={`how-it-works-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`how-it-works-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              // flex-auto (no columnas iguales): cada pestaña toma el ancho
              // de su texto y reparte el sobrante — así "Para organizadores"
              // entra en una sola línea en 390px sin achicar la fuente.
              className={`flex-auto whitespace-nowrap rounded-full px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand max-[359px]:px-1.5 max-[359px]:text-[11px] sm:px-3 sm:text-sm ${
                selected ? "bg-brand text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`how-it-works-panel-${key}`}
        aria-labelledby={`how-it-works-tab-${key}`}
        className="mt-10"
      >
        <Panel />
      </div>
    </section>
  );
}
