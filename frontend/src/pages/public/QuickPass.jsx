import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { Share2, Ticket, Check, ArrowLeft } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import { formatEventDateTime } from "../../lib/eventFormat.js";
import { usePublishFlow } from "../../hooks/usePublishFlow.js";
import { processPayment } from "../../lib/payment/paymentGateway.js";
import { getPublicServiceFeeTiers } from "../../lib/serviceFeeApi.js";
import { estimateServiceFeeForUnitPrice } from "../../lib/serviceFee.js";
import { isEventFinished } from "../../lib/eventFinished.js";
import { currency } from "../organizer/eventWizard/model.js";
import SelectTicketsStep from "./purchase/steps/SelectTicketsStep.jsx";
import BuyerInfoStep from "./purchase/steps/BuyerInfoStep.jsx";
import ErrorStep from "./purchase/steps/ErrorStep.jsx";
import PurchaseOverlay from "./purchase/PurchaseOverlay.jsx";

// Quick Pass V1 — pantalla pública mobile-first, imagen vertical de fondo.
// Es una CAPACIDAD DEL EVENT (quickPassEnabled/quickPassImageUrl viven en
// Event, ver event.service.js), nunca algo propio de un canal.
//
// Fest Pass V2 — este MISMO componente se monta en 2 rutas (App.jsx):
// /fest-pass/:slug (nueva) y /quick-pass/:slug (legacy, preservada por
// compatibilidad). Sólo el BRANDING visible depende de la ruta — ver
// `brandName` más abajo.
//
// Fest Pass V3 (esta ronda) — "Comprar entradas" YA NO navega a /comprar:
// pasa DENTRO de esta misma pantalla a 2 pasos más (Entradas / Datos del
// comprador), reutilizando SIN COPIAR los componentes reales del checkout
// (SelectTicketsStep/BuyerInfoStep/ErrorStep/PurchaseOverlay,
// usePublishFlow, processPayment, estimateServiceFeeForUnitPrice) — el
// motor transaccional (Sale, stock, Mercado Pago, QR, email, scanner) es
// EXACTAMENTE el mismo, sólo cambia dónde vive la UI de los primeros 2
// pasos. La confirmación de pago (redirect a Mercado Pago y su regreso)
// sigue yendo por el mismo circuito de siempre — no se tocó backend.
const EMPTY_BUYER = { firstName: "", lastName: "", email: "", document: "" };

// Cloudinary ya permite transformaciones por URL sin tocar el uploader ni
// crear infraestructura nueva: insertar "f_auto,q_auto,w_<ancho>" después
// de "/upload/" en la URL de entrega ya devuelta por Cloudinary reduce el
// peso real descargado (formato+calidad automáticos) sin cambiar un solo
// pixel visible. Si la URL no matchea el patrón esperado (no es una URL de
// Cloudinary, o viene con otro shape), se devuelve intacta — nunca rompe
// la imagen por intentar optimizarla.
function optimizedImageUrl(url, width) {
  if (!url) return url;
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const insertAt = idx + marker.length;
  return `${url.slice(0, insertAt)}f_auto,q_auto,w_${width}/${url.slice(insertAt)}`;
}

// Mismo criterio EXACTO que ticketOptionsFor (PurchaseWizard.jsx) — se
// duplica acá (función pura, ~10 líneas) en vez de importarla porque no
// está exportada y extraerla tocaría PurchaseWizard.jsx fuera del alcance
// de esta ronda. Ninguna regla de negocio nueva: mismo maxSelectable
// (stock real acotado por maxPerPurchase), mismo priceOverride/available.
function ticketOptionsFor(selectedFunction) {
  if (!selectedFunction) return [];
  return selectedFunction.ticketAssignments
    .filter((a) => a.visibleOverride ?? a.ticketType.visible)
    .map((a) => ({
      ticketTypeId: a.ticketTypeId,
      name: a.ticketType.name,
      description: a.ticketType.description,
      price: Number(a.priceOverride ?? a.ticketType.price),
      available: a.available,
      maxSelectable: Math.max(0, Math.min(a.available, a.ticketType.maxPerPurchase)),
    }));
}

function QuickPassSkeleton() {
  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-black">
      <div className="absolute inset-0 animate-pulse bg-white/5" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end gap-5 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="h-7 w-3/4 animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-white/10" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-14 w-full animate-pulse rounded-full bg-white/10" />
        <div className="h-12 w-full animate-pulse rounded-full bg-white/5" />
      </div>
    </div>
  );
}

export default function QuickPass() {
  const { slug } = useParams();
  const { pathname } = useLocation();
  const isFestPass = pathname.startsWith("/fest-pass/");
  const brandName = isFestPass ? "Fest Pass" : "Quick Pass";

  // Identidad persistente entre las 3 fases (evento → entradas → comprador)
  // — antes sólo aparecía en la fase "event"; en "tickets"/"buyer" no había
  // ningún indicio de marca, lo que hacía sentir esas 2 pantallas como el
  // checkout estándar. Mismo markup en las 3, sin duplicar estilos nuevos.
  function FestPassBadge() {
    return (
      <div className="flex items-center justify-center gap-2 pb-1 text-center">
        <span className="text-xs font-bold uppercase tracking-[0.3em] text-white/80">SmartTicket</span>
        <span className="h-1 w-1 rounded-full bg-fuchsia-400" />
        <span className="text-xs font-bold uppercase tracking-[0.3em] text-fuchsia-300">{brandName}</span>
      </div>
    );
  }
  const [state, setState] = useState({ status: "loading", data: null });
  const [shareState, setShareState] = useState("idle"); // idle | copied

  // "event" | "tickets" | "buyer" — pasos DENTRO de esta misma pantalla,
  // nunca una navegación a /comprar. `fullEventState` se carga una única
  // vez, recién al tocar "Comprar entradas" (nunca antes: el paso 1 sólo
  // necesita el payload liviano de Quick Pass) y se mantiene en memoria —
  // volver de "tickets"/"buyer" a "event" o entre sí NUNCA vuelve a pedirlo.
  const [phase, setPhase] = useState("event");
  const [fullEventState, setFullEventState] = useState({ status: "idle", event: null, error: "" });
  const [serviceFeeTiers, setServiceFeeTiers] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [purchaseError, setPurchaseError] = useState("");
  const publishFlow = usePublishFlow();
  const idempotencyKeyRef = useRef(null);

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

  // Carga completa (con maxPerPurchase/description por TicketType, que el
  // payload liviano de Quick Pass no trae) SÓLO al tocar "Comprar
  // entradas" — mismo endpoint público real que ya usa PurchaseWizard.jsx
  // (GET /api/events/public/:slug), nunca un endpoint nuevo. Best-effort
  // para las reglas de comisión (igual criterio que PurchaseWizard: si
  // falla, la estimación queda en $0, nunca bloquea).
  async function handleStartPurchase() {
    if (fullEventState.status === "ready") {
      setPhase("tickets");
      return;
    }
    setFullEventState({ status: "loading", event: null, error: "" });
    try {
      const { event: data } = await apiFetch(`/api/events/public/${slug}`);
      getPublicServiceFeeTiers()
        .then(setServiceFeeTiers)
        .catch((err) => console.error("No se pudieron cargar las reglas de comisión", err));
      if (!data || !data.functions || data.functions.length === 0) {
        setFullEventState({ status: "error", event: null, error: "Este evento no tiene entradas disponibles para comprar." });
        return;
      }
      setFullEventState({ status: "ready", event: data, error: "" });
      setPhase("tickets");
    } catch (err) {
      setFullEventState({ status: "error", event: null, error: err.message || "No pudimos cargar las entradas." });
    }
  }

  function handleQuantityChange(ticketTypeId, delta, ticketOptions) {
    const maxSelectable = ticketOptions.find((o) => o.ticketTypeId === ticketTypeId)?.maxSelectable ?? 0;
    setQuantities((prev) => ({
      ...prev,
      [ticketTypeId]: Math.min(maxSelectable, Math.max(0, (prev[ticketTypeId] ?? 0) + delta)),
    }));
  }

  async function handleConfirmPurchase(fullEvent, selectedFunction, lineItems, totals) {
    setPurchaseError("");
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    const idempotencyKey = idempotencyKeyRef.current;
    const items = lineItems.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity }));
    const confirmedTotals = {
      ticketsSubtotal: totals.ticketsSubtotal,
      serviceFee: totals.serviceFeeTotal,
      total: totals.total,
    };

    const action = () =>
      processPayment(
        { eventId: fullEvent.id, functionId: selectedFunction.id, items, buyer },
        { idempotencyKey, confirmedTotals }
      );

    try {
      const result = await publishFlow.run(action, { checkOutcome: action });
      // Mismo circuito real de siempre: navegación de nivel superior hacia
      // Mercado Pago, nunca dentro de la fetch ni en un iframe.
      window.location.href = result.checkoutUrl;
    } catch (err) {
      idempotencyKeyRef.current = null;
      if (err.code === "SERVICE_FEE_CHANGED" && err.errors) {
        // Sin un paso de Resumen propio en Fest Pass: se avisa y se pide
        // reconfirmar desde Entradas, nunca se redirige a Mercado Pago con
        // un importe que el backend ya rechazó.
        setPurchaseError("El precio cambió mientras elegías tus entradas. Volvé a revisar la cantidad y confirmá de nuevo.");
        setPhase("tickets");
        return;
      }
      setPurchaseError(err.message || "No pudimos procesar tu compra.");
    }
  }

  if (state.status === "loading") {
    return <QuickPassSkeleton />;
  }

  if (state.status === "unavailable") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-lg font-semibold text-white">{brandName} no está disponible para este evento.</p>
        <Link
          to={`/evento/${slug}`}
          state={{ forceEventDetail: true }}
          className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform duration-150 active:scale-95"
        >
          VER EVENTO
        </Link>
      </div>
    );
  }

  const event = state.data;
  const finished = isEventFinished(event);
  const functions = event.functions ?? [];
  const firstFunction = functions[0];
  const allTicketTypes = functions.flatMap((fn) => fn.ticketAssignments);
  const locationLabel = [event.venueName, event.city].filter(Boolean).join(" · ") || "Lugar a confirmar";
  const backgroundImage = optimizedImageUrl(event.quickPassImageUrl, 900);

  // Datos derivados del paso 2/3 — sólo existen una vez que fullEventState
  // está "ready" (después de tocar "Comprar entradas").
  const fullEvent = fullEventState.event;
  const selectedFunction = fullEvent?.functions?.[0] ?? null;
  const ticketOptions = ticketOptionsFor(selectedFunction);
  const lineItemsRaw = Object.entries(quantities).filter(([, qty]) => qty > 0);
  const lineItems = lineItemsRaw.map(([ticketTypeId, quantity]) => {
    const option = ticketOptions.find((o) => o.ticketTypeId === ticketTypeId);
    const unitPrice = option?.price ?? 0;
    const serviceFeeUnit = estimateServiceFeeForUnitPrice(unitPrice, serviceFeeTiers);
    return {
      ticketTypeId,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
      serviceFeeUnit,
      serviceFeeSubtotal: serviceFeeUnit * quantity,
    };
  });
  const ticketsSubtotal = lineItems.reduce((sum, i) => sum + i.subtotal, 0);
  const serviceFeeTotal = lineItems.reduce((sum, i) => sum + i.serviceFeeSubtotal, 0);
  const total = ticketsSubtotal + serviceFeeTotal;

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-black text-white">
      <img src={backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {/* Overlay oscuro + degradado — nunca branding configurable por
          organización (brandPrimaryColor), paleta fija violeta/magenta/azul
          eléctrico a propósito (ver el informe de la ronda). */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-violet-600/20 via-transparent to-blue-600/20" />

      {phase === "event" && (
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end gap-5 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
          <FestPassBadge />

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
                      {tt.available === 0 ? (
                        <span className="text-rose-300">AGOTADO</span>
                      ) : tt.price > 0 ? (
                        `$${tt.price.toLocaleString("es-AR")}`
                      ) : (
                        "GRATIS"
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {fullEventState.status === "error" && (
            <p className="text-center text-xs text-rose-300">{fullEventState.error}</p>
          )}

          <div className="flex flex-col gap-2.5">
            {finished ? (
              // Evento finalizado — sin CTA activo, mantiene la estética
              // neón/glass (ver informe de la ronda EVENT_FINISHED_GUARD):
              // nunca alert(), nunca oculta la pantalla completa.
              <p className="rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-center text-sm font-semibold text-white/70 backdrop-blur-md">
                Este evento finalizó
              </p>
            ) : (
              <button
                type="button"
                onClick={handleStartPurchase}
                disabled={fullEventState.status === "loading"}
                className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 px-6 py-4 text-base font-bold text-white shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-transform duration-150 active:scale-95 disabled:opacity-70"
              >
                <Ticket className="h-5 w-5" />
                {fullEventState.status === "loading" ? "CARGANDO..." : "COMPRAR ENTRADAS"}
              </button>
            )}

            {/* `state.forceEventDetail` — única forma de distinguir esta
                navegación EXPLÍCITA (el usuario tocó este botón a propósito)
                de un link directo/compartido a /evento/:slug: sin esto,
                EventDetail.jsx redirige de nuevo para acá mismo apenas ve
                quickPassEnabled=true, y "Ver detalle del evento" nunca
                mostraba nada. Vive en el state de la navegación (no en la
                URL/query): no ensucia el link, y sigue funcionando
                correctamente con el botón atrás del navegador (cada entrada
                del history mantiene su propio state). */}
            <Link
              to={`/evento/${event.slug}`}
              state={{ forceEventDetail: true }}
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
      )}

      {phase === "tickets" && fullEvent && (
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          <FestPassBadge />
          <button
            type="button"
            onClick={() => setPhase("event")}
            className="flex w-fit items-center gap-1.5 text-sm text-white/70 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al evento
          </button>
          <SelectTicketsStep
            event={fullEvent}
            selectedFunction={selectedFunction}
            ticketOptions={ticketOptions}
            quantities={quantities}
            onQuantityChange={(ticketTypeId, delta) => handleQuantityChange(ticketTypeId, delta, ticketOptions)}
            total={total}
            ticketsSubtotal={ticketsSubtotal}
            serviceFeeTotal={serviceFeeTotal}
            onContinue={() => setPhase("buyer")}
            cardVariant="glass"
          />
        </div>
      )}

      {phase === "buyer" && fullEvent && (
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          <FestPassBadge />
          {purchaseError ? (
            <ErrorStep
              message={purchaseError}
              onRetry={() => setPurchaseError("")}
              onBackToEvent={() => {
                setPurchaseError("");
                setPhase("tickets");
              }}
              cardVariant="glass"
            />
          ) : (
            <BuyerInfoStep
              buyer={buyer}
              onChange={setBuyer}
              onBack={() => setPhase("tickets")}
              onConfirm={() =>
                handleConfirmPurchase(fullEvent, selectedFunction, lineItems, { ticketsSubtotal, serviceFeeTotal, total })
              }
              cardVariant="glass"
              feeBreakdown={{
                ticketsSubtotalLabel: currency(ticketsSubtotal),
                serviceFeeLabel: currency(serviceFeeTotal),
                totalLabel: currency(total),
              }}
            />
          )}
        </div>
      )}

      <PurchaseOverlay open={publishFlow.publishing} checking={publishFlow.checkingOutcome} />
    </div>
  );
}
