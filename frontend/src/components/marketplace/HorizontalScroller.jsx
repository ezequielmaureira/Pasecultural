import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Carrusel horizontal genérico (concepto Netflix/Spotify: shelves de
// contenido, no grillas). Scroll nativo con snap para touch/trackpad —
// funciona fluido con el dedo sin JS de por medio — más flechas que
// aparecen al pasar el mouse, sólo en desktop (`lg`), para navegar con
// clicks. Cada hijo debe traer su propio ancho fijo (`shrink-0`) y
// `snap-start`; este componente no sabe qué está renderizando adentro.
export default function HorizontalScroller({ children, className = "" }) {
  const trackRef = useRef(null);

  function scrollByPage(direction) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <div className="group/scroller relative min-w-0">
      <div
        ref={trackRef}
        className={`no-scrollbar flex min-w-0 flex-nowrap snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-1 ${className}`}
      >
        {children}
      </div>

      <button
        type="button"
        aria-label="Anterior"
        onClick={() => scrollByPage(-1)}
        className="absolute left-0 top-1/2 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0B1120] text-white opacity-0 shadow-lg shadow-black/30 transition-opacity duration-150 group-hover/scroller:opacity-100 lg:flex"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Siguiente"
        onClick={() => scrollByPage(1)}
        className="absolute right-0 top-1/2 hidden h-10 w-10 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0B1120] text-white opacity-0 shadow-lg shadow-black/30 transition-opacity duration-150 group-hover/scroller:opacity-100 lg:flex"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
