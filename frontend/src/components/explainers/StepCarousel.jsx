import { Children, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Lista de pasos: carrusel horizontal con scroll-snap nativo en mobile y
// tablet (cada card ~85% del ancho, se asoma la siguiente, swipe natural,
// sin librerías) y grilla en desktop (`desktopGridClass`). Indicador
// "n / total" + flechas sólo mientras es carrusel. Teclado: el track es
// enfocable y responde a ←/→/Inicio/Fin; las flechas son botones reales.
export default function StepCarousel({ children, label, desktopGridClass = "lg:grid-cols-3" }) {
  const trackRef = useRef(null);
  const itemRefs = useRef([]);
  const [active, setActive] = useState(0);
  const items = Children.toArray(children);
  const total = items.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(Number(visible.target.dataset.index));
      },
      { root: track, threshold: [0.6, 0.9] }
    );
    itemRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [total]);

  const goTo = useCallback(
    (index) => {
      const target = itemRefs.current[Math.max(0, Math.min(total - 1, index))];
      const track = trackRef.current;
      if (!target || !track) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      track.scrollTo({
        left: target.offsetLeft - (track.clientWidth - target.clientWidth) / 2,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [total]
  );

  function handleKeyDown(event) {
    const moves = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: total - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    goTo(moves[event.key]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={trackRef}
        tabIndex={0}
        role="region"
        aria-roledescription="carrusel"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="no-scrollbar relative -mx-4 snap-x snap-mandatory overflow-x-auto scroll-px-4 px-4 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 lg:mx-0 lg:overflow-visible lg:px-0 lg:focus-visible:ring-0"
      >
        <ol className={`flex gap-3 lg:grid lg:gap-4 ${desktopGridClass}`}>
          {items.map((child, index) => (
            <li
              key={index}
              ref={(node) => (itemRefs.current[index] = node)}
              data-index={index}
              aria-label={`Paso ${index + 1} de ${total}`}
              className="w-[85%] shrink-0 snap-center sm:w-[46%] lg:w-auto"
            >
              {child}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center justify-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="Paso anterior"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {items.map((_, index) => (
            <span
              key={index}
              className={`h-1.5 rounded-full transition-all duration-200 ${index === active ? "w-5 bg-brand" : "w-1.5 bg-white/20"}`}
            />
          ))}
        </div>
        <p className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums text-slate-300" aria-live="polite">
          {active + 1} / {total}
        </p>
        <button
          type="button"
          onClick={() => goTo(active + 1)}
          disabled={active === total - 1}
          aria-label="Paso siguiente"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
