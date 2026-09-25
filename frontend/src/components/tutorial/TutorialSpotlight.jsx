import { useEffect, useLayoutEffect, useRef, useState } from "react";
import TutorialCallout from "./TutorialCallout.jsx";

const MARGIN = 12;
const RING_PADDING = 6;
const FALLBACK_CALLOUT_SIZE = { width: 320, height: 170 };

function measureTarget(targetKey) {
  const el = document.querySelector(`[data-tutorial="${targetKey}"]`);
  if (!el) return null;
  return { el, rect: el.getBoundingClientRect() };
}

// bottom por defecto; cae a top si no entra abajo. Siempre clamped al
// viewport para nunca salirse de pantalla (mobile incluido).
function computePlacement(targetRect, calloutSize) {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - targetRect.bottom;
  const spaceAbove = targetRect.top;

  let placement = "bottom";
  let top;
  if (spaceBelow >= calloutSize.height + MARGIN || spaceBelow >= spaceAbove) {
    placement = "bottom";
    top = targetRect.bottom + MARGIN;
  } else {
    placement = "top";
    top = targetRect.top - calloutSize.height - MARGIN;
  }

  let left = targetRect.left + targetRect.width / 2 - calloutSize.width / 2;
  left = Math.min(Math.max(left, MARGIN), viewportW - calloutSize.width - MARGIN);
  top = Math.min(Math.max(top, MARGIN), viewportH - calloutSize.height - MARGIN);

  return { placement, top, left };
}

// Spotlight real sobre la UI — nunca un modal/screenshot. `targetKey` es el
// valor de un data-tutorial="..." ya presente en ConversationView.jsx/
// PreviewCard.jsx. `stepKey` identifica el "paso de tutorial" actual (por
// ejemplo prompt.stepId, o "PREVIEW:overview"/"PREVIEW:publish") — al
// cambiar, el callout de "Entendido" vuelve a aparecer para el paso nuevo,
// pero eso NUNCA controla la navegación real: sólo decide si esta capa
// visual se muestra o no. El anillo/backdrop usan un único div con
// box-shadow (`0 0 0 9999px ...`) y pointer-events-none — oscurece todo el
// viewport MENOS el target, sin cubrirlo nunca: el elemento real sigue
// siendo exactamente el mismo nodo del DOM, clickeable/escribible sin
// ningún overlay encima.
export default function TutorialSpotlight({
  active,
  targetKey,
  stepKey,
  title,
  description,
  videoUrl,
  index,
  total,
  onExitTutorial,
  onStepDismissed,
}) {
  const [dismissed, setDismissed] = useState(false);
  const [rect, setRect] = useState(null);
  const calloutRef = useRef(null);
  const [calloutSize, setCalloutSize] = useState(FALLBACK_CALLOUT_SIZE);

  // Nuevo paso de tutorial -> el "Entendido" de un paso anterior no debe
  // seguir ocultando el de este. Nunca toca nada fuera de esta capa visual.
  useEffect(() => {
    setDismissed(false);
  }, [stepKey]);

  useEffect(() => {
    if (!active || dismissed || !targetKey) {
      setRect(null);
      return undefined;
    }

    let cancelled = false;
    let scrolledIntoView = false;

    function recompute() {
      const found = measureTarget(targetKey);
      if (!found) {
        if (!cancelled) setRect(null);
        return;
      }
      if (!scrolledIntoView) {
        scrolledIntoView = true;
        found.el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (!cancelled) setRect(found.rect);
    }

    recompute();
    // Reintento corto tras el scrollIntoView suave (la posición cambia
    // mientras anima) — sin esto el ring queda "pegado" a la posición
    // previa al scroll hasta el próximo resize/scroll del usuario.
    const timeoutId = window.setTimeout(recompute, 350);

    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [active, dismissed, targetKey, stepKey]);

  useLayoutEffect(() => {
    if (!calloutRef.current) return;
    const measured = calloutRef.current.getBoundingClientRect();
    if (
      measured.width &&
      measured.height &&
      (Math.abs(measured.width - calloutSize.width) > 1 || Math.abs(measured.height - calloutSize.height) > 1)
    ) {
      setCalloutSize({ width: measured.width, height: measured.height });
    }
  });

  useEffect(() => {
    if (!active) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onExitTutorial();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onExitTutorial]);

  if (!active || dismissed || !rect) return null;

  const { placement, top, left } = computePlacement(rect, calloutSize);

  return (
    <>
      {/* Ring + "backdrop" en un único elemento: el box-shadow gigante
          oscurece todo el viewport salvo el rect del target, sin agregar
          ningún nodo que lo cubra — pointer-events-none garantiza que
          nunca intercepta clicks, ni siquiera sobre sí mismo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-50 rounded-2xl border-2 border-lime-400/80 shadow-[0_0_0_9999px_rgba(2,4,10,0.72),0_0_26px_rgba(190,242,100,0.55)] transition-all duration-200 ease-out"
        style={{
          top: rect.top - RING_PADDING,
          left: rect.left - RING_PADDING,
          width: rect.width + RING_PADDING * 2,
          height: rect.height + RING_PADDING * 2,
        }}
      />
      <TutorialCallout
        title={title}
        description={description}
        videoUrl={videoUrl}
        index={index}
        total={total}
        placement={placement}
        calloutRef={calloutRef}
        style={{ top, left }}
        onDismiss={() => {
          setDismissed(true);
          onStepDismissed?.();
        }}
        onExitTutorial={onExitTutorial}
      />
    </>
  );
}
