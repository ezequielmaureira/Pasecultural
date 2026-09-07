import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Share2, Ticket, Check } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import { formatEventDateTime } from "../../lib/eventFormat.js";

// Quick Pass V1 — pantalla pública mobile-first, imagen vertical de fondo.
// Es una CAPACIDAD DEL EVENT (quickPassEnabled/quickPassImageUrl viven en
// Event, ver event.service.js), nunca algo propio de un canal: funciona
// exactamente igual sin importar si el evento se cargó desde la Web o desde
// el bot de WhatsApp (ambos terminan en el mismo createEventService/
// updateMyEventService — ver EventServicePort.commit). Esta pantalla NO
// reimplementa ningún selector de cantidades/carrito: "Comprar entradas"
// entrega al PurchaseWizard real (mismo checkout, mismo stock, mismo Sale/
// Ticket/QR/email de siempre) en vez de duplicar esa lógica acá.
export default function QuickPass() {
  const { slug } = useParams();
  const [state, setState] = useState({ status: "loading", data: null });
  const [shareState, setShareState] = useState("idle"); // idle | copied

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null });

    apiFetch(`/api/events/public/quick-pass/${slug}`)
      .then((result) => {
        if (cancelled) return;
        setState({ status: result.available ? "available" : "unavailable", data: result.event ?? null });
      })
      .catch((err) => {
        console.error("No se pudo cargar Quick Pass", err);
        if (!cancelled) setState({ status: "unavailable", data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const shareUrl = useMemo(() => (typeof window !== "undefined" ? window.location.href : ""), []);

  async function handleShare(title) {
    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch {
        // Usuario canceló el share nativo — no hacer nada, no es un error.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      // Sin Web Share API ni Clipboard disponible: no hay fallback más
      // liviano posible sin agregar una dependencia nueva.
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-black text-sm text-slate-400">
        Cargando...
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-lg font-semibold text-white">Quick Pass no está disponible para este evento.</p>
        <Link
          to={`/evento/${slug}`}
          className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform duration-150 active:scale-95"
        >
          VER EVENTO
        </Link>
      </div>
    );
  }

  const event = state.data;
  const functions = event.functions ?? [];
  const firstFunction = functions[0];
  const allTicketTypes = functions.flatMap((fn) => fn.ticketAssignments);
  const locationLabel = [event.venueName, event.city].filter(Boolean).join(" · ") || "Lugar a confirmar";

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-black text-white">
      <img
        src={event.quickPassImageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Overlay oscuro + degradado — nunca branding configurable por
          organización (brandPrimaryColor), paleta fija violeta/magenta/azul
          eléctrico a propósito (ver el informe de la ronda). */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-violet-600/20 via-transparent to-blue-600/20" />

      <div
        className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end gap-5 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      >
        <div className="flex items-center justify-center gap-2 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.3em] text-white/80">SmartTicket</span>
          <span className="h-1 w-1 rounded-full bg-fuchsia-400" />
          <span className="text-xs font-bold uppercase tracking-[0.3em] text-fuchsia-300">Quick Pass</span>
        </div>

        <div className="rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-extrabold leading-tight text-white">{event.title}</h1>
          {firstFunction && (
            <p className="mt-2 text-sm text-white/80">{formatEventDateTime(firstFunction.date)}</p>
          )}
          <p className="mt-0.5 text-sm text-white/70">{locationLabel}</p>

          {allTicketTypes.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Elegí tus entradas</p>
              {allTicketTypes.map((tt, i) => (
                <div key={`${tt.ticketTypeId}-${i}`} className="flex items-center justify-between text-sm">
                  <span className="text-white/90">{tt.name}</span>
                  <span className="font-semibold text-white">
                    {tt.price > 0 ? `$${tt.price.toLocaleString("es-AR")}` : "Gratis"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <Link
            to={`/comprar?slug=${event.slug}`}
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 px-6 py-4 text-base font-bold text-white shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-transform duration-150 active:scale-95"
          >
            <Ticket className="h-5 w-5" />
            COMPRAR ENTRADAS
          </Link>

          <Link
            to={`/evento/${event.slug}`}
            className="flex items-center justify-center rounded-full border border-white/25 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition-colors duration-150 active:bg-white/15"
          >
            VER DETALLE DEL EVENTO
          </Link>

          <button
            type="button"
            onClick={() => handleShare(event.title)}
            className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-white/70 transition-colors duration-150 active:text-white"
          >
            {shareState === "copied" ? (
              <>
                <Check className="h-4 w-4" /> Enlace copiado
              </>
            ) : (
              <>
                <Share2 className="h-4 w-4" /> Compartir
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
