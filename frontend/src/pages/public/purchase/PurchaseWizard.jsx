import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import StepIndicator from "../../../components/ui/StepIndicator.jsx";
import { usePublishFlow } from "../../../hooks/usePublishFlow.js";
import { apiFetch } from "../../../lib/api.js";
import { getSaleStatus } from "../../../lib/saleApi.js";
import { getPublicServiceFeeTiers } from "../../../lib/serviceFeeApi.js";
import { estimateServiceFeeForUnitPrice } from "../../../lib/serviceFee.js";
import { processPayment } from "../../../lib/payment/paymentGateway.js";
import { useOrganizationThemeProps } from "../../../hooks/useOrganizationThemeProps.js";
import PurchaseOverlay from "./PurchaseOverlay.jsx";
import SelectFunctionStep from "./steps/SelectFunctionStep.jsx";
import SelectTicketsStep from "./steps/SelectTicketsStep.jsx";
import SummaryStep from "./steps/SummaryStep.jsx";
import BuyerInfoStep from "./steps/BuyerInfoStep.jsx";
import SuccessStep from "./steps/SuccessStep.jsx";
import ErrorStep from "./steps/ErrorStep.jsx";

const UNRESOLVED_PURCHASE_MESSAGE =
  "No pudimos confirmar si tu compra se completó. Revisá tu email antes de volver a intentar para no comprar dos veces.";

const EMPTY_BUYER = { firstName: "", lastName: "", email: "", document: "" };

// Recuperación de una venta ya creada (por saleToken en la URL): cada cuánto
// se vuelve a preguntar /status mientras sigue PENDING, y cuánto tiempo
// total se le da antes de rendirse y ofrecer reintentar manualmente.
const SALE_POLL_INTERVAL_MS = 2500;
const SALE_POLL_TIMEOUT_MS = 60000;
const TERMINAL_FAILED_STATUSES = new Set(["CANCELLED", "EXPIRED"]);

const SALE_FAILED_MESSAGE_BY_STATUS = {
  CANCELLED: "Esta compra fue cancelada.",
  EXPIRED: "Esta compra venció antes de confirmarse.",
};

function buildSteps(hasMultipleFunctions) {
  const steps = [];
  let id = 1;
  if (hasMultipleFunctions) steps.push({ id: id++, label: "Función" });
  steps.push({ id: id++, label: "Entradas" });
  steps.push({ id: id++, label: "Resumen" });
  steps.push({ id, label: "Comprador" });
  return steps;
}

function ticketOptionsFor(selectedFunction) {
  if (!selectedFunction) return [];
  return selectedFunction.ticketAssignments
    .filter((a) => a.visibleOverride ?? a.ticketType.visible)
    .map((a) => ({
      ticketTypeId: a.ticketTypeId,
      name: a.ticketType.name,
      description: a.ticketType.description,
      price: Number(a.priceOverride ?? a.ticketType.price),
      // Stock real al momento de cargar el Wizard (calculado por el backend
      // en getPublicEventBySlugService) — se usa tal cual como `max` de la
      // barra de disponibilidad en SelectTicketsStep.
      available: a.available,
      // El selector de cantidad nunca puede pasar de acá: mínimo entre lo
      // que queda de stock real (`available`) y el máximo por compra del
      // tipo de entrada. Antes esto no se leía del payload público y el "+"
      // no tenía techo — ver auditoría del bug de sobreventa.
      maxSelectable: Math.max(0, Math.min(a.available, a.ticketType.maxPerPurchase)),
    }));
}

// Reemplaza por completo a Checkout.jsx/Payment.jsx. El pago en sí es una
// caja negra para este componente — sólo llama a processPayment() (ver
// lib/payment/paymentGateway.js). MP-2 cambió esa función (ahora crea un
// checkout de Mercado Pago y redirige) sin tocar una sola línea de este
// componente más allá de handleConfirmPurchase, exactamente como estaba
// previsto.
export default function PurchaseWizard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = searchParams.get("slug");
  // publicRecoveryToken de la venta en curso, viajando en la URL (no sólo
  // en estado de React) — sobrevive a una recarga de página o, desde MP-2,
  // al redirect real de vuelta desde Mercado Pago (back_urls la incluyen,
  // ver mercadoPagoCheckout.service.js en el backend). Nunca el `id`
  // interno del Sale (ver sale.service.js#getSaleStatusService).
  const resumeToken = searchParams.get("saleToken");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [event, setEvent] = useState(null);
  // MP-6 — reglas de comisión vigentes, sólo para mostrar una ESTIMACIÓN
  // en SummaryStep antes de pagar (ver lib/serviceFee.js). El cálculo
  // AUTORITATIVO final lo hace siempre el backend al crear el checkout —
  // si esta carga falla o todavía no llegó, la estimación de comisión
  // simplemente muestra $0 hasta que esté disponible, nunca bloquea la
  // compra.
  const [serviceFeeTiers, setServiceFeeTiers] = useState([]);

  // "function" | "tickets" | "summary" | "buyer-info" | "success" | "purchase-error"
  const [phase, setPhase] = useState("tickets");
  const [selectedFunctionId, setSelectedFunctionId] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchasedTickets, setPurchasedTickets] = useState([]);
  // Para el aviso "también te lo mandamos a tu correo" en SuccessStep — sólo
  // se muestra si emailDeliveryStatus es realmente "SENT" (ver
  // sendSaleConfirmationEmail.service.js en el backend). Nunca se asume: si
  // Resend falló, no hay que prometerle al comprador algo que no pasó.
  const [purchaseBuyerEmail, setPurchaseBuyerEmail] = useState("");
  const [purchaseEmailDeliveryStatus, setPurchaseEmailDeliveryStatus] = useState(null);
  // Ronda de endurecimiento — distinto de purchaseError: se llena cuando el
  // backend responde SERVICE_FEE_CHANGED (ver createSaleForBuyer,
  // sale.service.js) con el desglose AUTORITATIVO actualizado
  // (ticketsSubtotal/serviceFee/total). Mientras está seteado, SummaryStep
  // muestra esos números en vez de la estimación cliente y un aviso de que
  // el precio cambió — nunca redirige solo a Mercado Pago con otro importe,
  // siempre vuelve a "summary" a pedir una reconfirmación explícita. Se
  // limpia si el comprador cambia la selección de entradas (otra selección
  // ya no corresponde a este desglose).
  const [priceChangeNotice, setPriceChangeNotice] = useState(null);

  // Ciclo de vida de recuperar una venta ya creada por su saleToken (URL):
  // "idle" (nada que recuperar) | "checking" (primera consulta en curso) |
  // "pending" (CONFIRMED todavía no — reintentando cada pocos segundos) |
  // "check-error" (falló la consulta en sí, red/servidor) | "poll-timeout"
  // (siguió PENDING más de SALE_POLL_TIMEOUT_MS) | "sale-failed" (CANCELLED
  // o EXPIRED — terminal, ya no tiene sentido seguir preguntando).
  const [saleRecoveryState, setSaleRecoveryState] = useState(resumeToken ? "checking" : "idle");
  const [saleRecoveryMessage, setSaleRecoveryMessage] = useState("");
  // Cambiarlo re-dispara todo el efecto de abajo desde cero: es lo que usan
  // los botones "Reintentar consulta" (misma venta, nunca crea una nueva).
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  const publishFlow = usePublishFlow();

  // Continuidad visual del Organization Theme desde EventDetail — mismo
  // criterio: siempre según la Organization dueña del evento. Sólo
  // continuidad visual, no toca lógica de compra/precio/stock/pago.
  const { className: themeClassName, style: themeStyle } = useOrganizationThemeProps({
    slug: event?.organization?.slug,
    name: event?.organization?.name,
    logo: event?.organization?.branding?.logo,
    primaryColor: event?.organization?.branding?.primaryColor,
    secondaryColor: event?.organization?.branding?.secondaryColor,
  });

  // Clave de idempotencia de un intento de compra en curso — una por click
  // en "Confirmar compra" (no una por request): se genera lazy la primera
  // vez y se reutiliza en los reintentos automáticos de usePublishFlow
  // (timeout + checkOutcome), para que nunca terminen creando dos ventas
  // ni dos preferencias por el mismo intento lógico. Un reintento manual
  // después de un error real (el comprador vuelve a tocar "Confirmar") la
  // resetea: eso sí cuenta como un intento nuevo. Ver
  // lib/payment/paymentGateway.js.
  const idempotencyKeyRef = useRef(null);

  // Desde MP-2, este efecto también es lo que retoma una compra cuando el
  // navegador vuelve de Checkout Pro (back_urls llevan ?saleToken=, ver
  // mercadoPagoCheckout.service.js) — nunca antes: handleConfirmPurchase
  // manda al comprador afuera de PaseCultural apenas tiene la URL de
  // checkout, así que este mismo montaje del componente no sigue viva la
  // compra que acaba de iniciar, sólo una que llega de afuera (recarga de
  // página, o el regreso real desde Mercado Pago).
  //
  // Todo el ciclo de consulta + polling vive en un solo efecto para poder
  // limpiar un único interval/flag al desmontar (o al re-disparar por
  // recoveryAttempt) sin dejar dos pollings corriendo en paralelo. La guarda
  // `cancelled` cubre el caso de React StrictMode en desarrollo: monta,
  // desmonta y vuelve a montar el efecto una vez al inicio — la primera
  // pasada limpia su propio interval y descarta cualquier respuesta tardía
  // antes de que la segunda (la que de verdad queda viva) arranque la suya.
  useEffect(() => {
    if (!resumeToken) return undefined;

    let cancelled = false;
    let intervalId = null;
    let elapsedMs = 0;

    function stopPolling() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function startPollingIfNeeded() {
      if (cancelled || intervalId !== null) return;
      intervalId = setInterval(() => {
        elapsedMs += SALE_POLL_INTERVAL_MS;
        if (elapsedMs >= SALE_POLL_TIMEOUT_MS) {
          stopPolling();
          setSaleRecoveryState("poll-timeout");
          return;
        }
        checkOnce();
      }, SALE_POLL_INTERVAL_MS);
    }

    async function checkOnce() {
      try {
        const result = await getSaleStatus(resumeToken);
        if (cancelled) return;

        if (result?.status === "CONFIRMED" && Array.isArray(result.tickets) && result.tickets.length > 0) {
          stopPolling();
          setPurchasedTickets(result.tickets);
          setPurchaseBuyerEmail(result.buyerEmail ?? "");
          setPurchaseEmailDeliveryStatus(result.emailDeliveryStatus ?? null);
          setSaleRecoveryState("idle");
          setPhase("success");
          return;
        }

        if (TERMINAL_FAILED_STATUSES.has(result?.status)) {
          stopPolling();
          setSaleRecoveryMessage(
            SALE_FAILED_MESSAGE_BY_STATUS[result.status] || "Esta compra no pudo confirmarse."
          );
          setSaleRecoveryState("sale-failed");
          return;
        }

        // PENDING (o, en teoría, CONFIRMED sin tickets todavía): sigue viva,
        // hay que seguir esperando.
        setSaleRecoveryState("pending");
        startPollingIfNeeded();
      } catch (err) {
        if (cancelled) return;
        stopPolling();
        setSaleRecoveryMessage(err.message || "No pudimos confirmar el estado de tu compra.");
        setSaleRecoveryState("check-error");
      }
    }

    setSaleRecoveryState("checking");
    setSaleRecoveryMessage("");
    checkOnce();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [resumeToken, recoveryAttempt]);

  // Sólo se llega a un estado "sale-failed" (CANCELLED/EXPIRED) después de
  // haber confirmado con el backend que esa venta puntual ya no va a
  // avanzar — recién ahí tiene sentido soltar el saleToken y dejar arrancar
  // una compra nueva.
  function handleRestartAfterFailedSale() {
    const next = new URLSearchParams(searchParams);
    next.delete("saleToken");
    setSearchParams(next, { replace: true });
    setSaleRecoveryState("idle");
    setSaleRecoveryMessage("");
  }

  const load = useCallback(async () => {
    if (!slug) {
      setLoadError("Falta indicar qué evento querés comprar.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const { event: data } = await apiFetch(`/api/events/public/${slug}`);
      // Best-effort: si esta llamada falla, la estimación de comisión
      // simplemente queda en $0 hasta que se pueda cargar — nunca bloquea
      // ni retrasa la carga del evento en sí (que es lo único
      // imprescindible para seguir).
      getPublicServiceFeeTiers()
        .then(setServiceFeeTiers)
        .catch((err) => console.error("No se pudieron cargar las reglas de comisión", err));
      if (!data) {
        setLoadError("Este evento no existe o ya no está disponible.");
        return;
      }
      // Defensa de UX solamente — la seguridad real está en el backend
      // (createSaleForBuyer/createMercadoPagoCheckoutService rechazan
      // cualquier Sale sobre un evento FREE_ENTRY). Esto sólo evita que
      // alguien navegando directo a /comprar?slug=... quede en un paso de
      // selección de entradas vacío para un evento que nunca las tuvo.
      if (data.admissionType === "FREE_ENTRY") {
        setLoadError("Este evento es de entrada gratuita — no tiene sistema de venta de entradas.");
        return;
      }
      if (!data.functions || data.functions.length === 0) {
        setLoadError("Este evento todavía no tiene funciones disponibles para comprar.");
        return;
      }
      setEvent(data);
      if (data.functions.length === 1) {
        setSelectedFunctionId(data.functions[0].id);
        setPhase("tickets");
      } else {
        setPhase("function");
      }
    } catch (err) {
      setLoadError(err.message || "No pudimos cargar el evento.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Se resuelve antes que cualquier otra cosa: no tiene sentido arrancar (o
  // reiniciar) el Wizard mientras todavía no se sabe si la URL trae una
  // compra por recuperar, confirmada o en curso. No depende de `event` —
  // los tickets que trae /status ya vienen con todo lo que necesita
  // SuccessStep.
  if (saleRecoveryState === "checking") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Recuperando tu compra...</p>
      </div>
    );
  }

  if (saleRecoveryState === "pending") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Estamos confirmando tu compra...</p>
      </div>
    );
  }

  if (saleRecoveryState === "check-error" || saleRecoveryState === "poll-timeout") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <ErrorStep
          message={
            saleRecoveryState === "poll-timeout"
              ? "Todavía no pudimos confirmar tu compra. Puede que se haya completado igual — reintentá la consulta antes de comprar de nuevo."
              : saleRecoveryMessage
          }
          retryLabel="Reintentar consulta"
          onRetry={() => setRecoveryAttempt((n) => n + 1)}
          onBackToEvent={() => navigate(slug ? `/evento/${slug}` : "/eventos")}
        />
      </div>
    );
  }

  if (saleRecoveryState === "sale-failed") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <ErrorStep
          message={saleRecoveryMessage}
          retryLabel="Reiniciar compra"
          onRetry={handleRestartAfterFailedSale}
          onBackToEvent={() => navigate(slug ? `/evento/${slug}` : "/eventos")}
        />
      </div>
    );
  }

  // También antes que la carga del evento: una compra ya resuelta (por el
  // efecto de recuperación de arriba, o por handleConfirmPurchase más abajo)
  // se muestra igual aunque `event`/`slug` no estén disponibles — SuccessStep
  // no depende de ninguno de los dos, todo lo que necesita ya vino en `tickets`.
  if (phase === "success") {
    return (
      <div className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-10">
        <SuccessStep
          tickets={purchasedTickets}
          buyerEmail={purchaseBuyerEmail}
          emailDeliveryStatus={purchaseEmailDeliveryStatus}
          recoveryToken={resumeToken}
          onKeepExploring={() => navigate("/eventos")}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Cargando evento...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <ErrorStep message={loadError} onBackToEvent={() => navigate("/eventos")} />
      </div>
    );
  }

  const selectedFunction = event.functions.find((f) => f.id === selectedFunctionId) ?? null;
  const ticketOptions = ticketOptionsFor(selectedFunction);
  const items = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
  const lineItems = items.map(({ ticketTypeId, quantity }) => {
    const option = ticketOptions.find((o) => o.ticketTypeId === ticketTypeId);
    const unitPrice = option?.price ?? 0;
    // MP-6 — estimación de comisión de servicio por tipo de entrada, sólo
    // para mostrarla acá antes de pagar (ver SummaryStep) — el importe
    // real que se cobra siempre lo calcula y fotografía el backend al
    // crear el checkout (createSaleForBuyer, sale.service.js).
    const serviceFeeUnit = estimateServiceFeeForUnitPrice(unitPrice, serviceFeeTiers);
    return {
      ticketTypeId,
      name: option?.name ?? "",
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
      serviceFeeUnit,
      serviceFeeSubtotal: serviceFeeUnit * quantity,
    };
  });
  const ticketsSubtotal = lineItems.reduce((sum, item) => sum + item.subtotal, 0);
  const serviceFeeTotal = lineItems.reduce((sum, item) => sum + item.serviceFeeSubtotal, 0);
  const total = ticketsSubtotal + serviceFeeTotal;

  // Mientras haya un priceChangeNotice activo, estos son los números que se
  // muestran y los que se reenvían como confirmedTotals — son el desglose
  // AUTORITATIVO que el backend ya recalculó, más actualizado que la
  // estimación cliente de arriba (ver comentario de priceChangeNotice).
  const displayedTicketsSubtotal = priceChangeNotice ? priceChangeNotice.ticketsSubtotal : ticketsSubtotal;
  const displayedServiceFeeTotal = priceChangeNotice ? priceChangeNotice.serviceFee : serviceFeeTotal;
  const displayedTotal = priceChangeNotice ? priceChangeNotice.total : total;

  const steps = buildSteps(event.functions.length > 1);
  const stepIdByLabel = Object.fromEntries(steps.map((s) => [s.label, s.id]));
  const currentStepId =
    phase === "function"
      ? stepIdByLabel["Función"]
      : phase === "tickets"
      ? stepIdByLabel["Entradas"]
      : phase === "summary"
      ? stepIdByLabel["Resumen"]
      : stepIdByLabel["Comprador"];

  function handleQuantityChange(ticketTypeId, delta) {
    const maxSelectable = ticketOptions.find((o) => o.ticketTypeId === ticketTypeId)?.maxSelectable ?? 0;
    setQuantities((prev) => ({
      ...prev,
      [ticketTypeId]: Math.min(maxSelectable, Math.max(0, (prev[ticketTypeId] ?? 0) + delta)),
    }));
    // Otra selección ya no corresponde al desglose que el backend rechazó.
    setPriceChangeNotice(null);
  }

  // Nunca pasa por Clerk: ni token, ni getAuth, ni isSignedIn. La identidad
  // del comprador es exactamente lo que completó en BuyerInfoStep.
  //
  // MP-2: processPayment() ya no confirma nada acá — crea el checkout de
  // Mercado Pago y devuelve la URL a la que hay que navegar. Por eso
  // checkOutcome es la MISMA `action`: el backend es idempotente para
  // idempotencyKeyRef.current, así que si usePublishFlow.run() tiene que
  // reintentar después de un timeout del lado del cliente, repetir la
  // llamada nunca crea una segunda venta ni una segunda preferencia — o
  // recibe de vuelta el mismo checkoutUrl de siempre, o termina de crearlo
  // si el primer intento nunca había llegado a hacerlo.
  async function handleConfirmPurchase() {
    setPurchaseError("");
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    const idempotencyKey = idempotencyKeyRef.current;
    // Lo que el comprador vio confirmado en SummaryStep — NUNCA autoritativo
    // (ver saleApi.js#createMercadoPagoCheckout). Sólo sirve para que el
    // backend detecte si cambió mientras estaba en el Wizard.
    const confirmedTotals = {
      ticketsSubtotal: displayedTicketsSubtotal,
      serviceFee: displayedServiceFeeTotal,
      total: displayedTotal,
    };

    const action = () => {
      console.log("PurchaseWizard.handleConfirmPurchase action starting", {
        eventId: event.id,
        functionId: selectedFunctionId,
        items,
        buyer,
      });
      return processPayment({ eventId: event.id, functionId: selectedFunctionId, items, buyer }, { idempotencyKey, confirmedTotals });
    };

    try {
      const result = await publishFlow.run(action, { checkOutcome: action, unresolvedMessage: UNRESOLVED_PURCHASE_MESSAGE });
      console.log("PurchaseWizard.handleConfirmPurchase after publishFlow.run", {
        hasCheckoutUrl: Boolean(result?.checkoutUrl),
      });
      // Navegación real de nivel superior hacia Mercado Pago — nunca dentro
      // de la llamada fetch, y nunca en un iframe. El comprador vuelve
      // eventualmente por back_urls (?saleToken=...), que retoma el mismo
      // polling de arriba; esta pantalla no confirma nada por su cuenta.
      window.location.href = result.checkoutUrl;
    } catch (err) {
      console.error("PurchaseWizard.handleConfirmPurchase caught error", err);
      console.error(err.response);
      console.error(err.data);
      console.error(err.stack);
      // Cualquier error (incluido SERVICE_FEE_CHANGED) invalida el intento
      // en curso: el próximo click genera una idempotencyKey distinta.
      idempotencyKeyRef.current = null;

      // Ronda de endurecimiento — el precio/comisión cambió entre el
      // resumen y la creación del checkout (ver SERVICE_FEE_CHANGED,
      // sale.service.js). El backend NO creó Sale, reserva de stock ni
      // preferencia: nunca hay que redirigir a Mercado Pago acá. En vez de
      // ir a "purchase-error", se vuelve a "summary" con el desglose
      // autoritativo actualizado (err.errors) para que el comprador lo vea
      // y confirme de nuevo explícitamente.
      if (err.code === "SERVICE_FEE_CHANGED" && err.errors) {
        console.warn("PurchaseWizard.handleConfirmPurchase: la comisión/precio cambió, volviendo a Resumen", err.errors);
        setPriceChangeNotice({
          ticketsSubtotal: Number(err.errors.ticketsSubtotal),
          serviceFee: Number(err.errors.serviceFee),
          total: Number(err.errors.total),
        });
        setPhase("summary");
        return;
      }

      setPurchaseError(err.message || "No pudimos procesar tu compra.");
      setPhase("purchase-error");
    }
  }

  return (
    <div style={themeStyle} className={`${themeClassName} mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-10`}>
      {phase !== "success" && phase !== "purchase-error" && (
        <Link
          to={`/evento/${event.slug}`}
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al evento
        </Link>
      )}

      {phase !== "purchase-error" && <StepIndicator steps={steps} step={currentStepId} onStepClick={() => {}} clickable={false} />}

      {phase === "function" && (
        <SelectFunctionStep
          functions={event.functions}
          selectedFunctionId={selectedFunctionId}
          onSelect={setSelectedFunctionId}
          onContinue={() => setPhase("tickets")}
        />
      )}

      {phase === "tickets" && selectedFunction && (
        <SelectTicketsStep
          event={event}
          selectedFunction={selectedFunction}
          ticketOptions={ticketOptions}
          quantities={quantities}
          onQuantityChange={handleQuantityChange}
          total={total}
          onContinue={() => setPhase("summary")}
        />
      )}

      {phase === "summary" && selectedFunction && (
        <SummaryStep
          event={event}
          selectedFunction={selectedFunction}
          lineItems={lineItems}
          ticketsSubtotal={displayedTicketsSubtotal}
          serviceFeeTotal={displayedServiceFeeTotal}
          total={displayedTotal}
          priceChanged={Boolean(priceChangeNotice)}
          onBack={() => setPhase("tickets")}
          onContinue={() => setPhase("buyer-info")}
        />
      )}

      {phase === "buyer-info" && (
        <BuyerInfoStep
          buyer={buyer}
          onChange={setBuyer}
          onBack={() => setPhase("summary")}
          onConfirm={handleConfirmPurchase}
        />
      )}

      {phase === "purchase-error" && (
        <ErrorStep
          message={purchaseError}
          onRetry={() => setPhase("summary")}
          onBackToEvent={() => navigate(`/evento/${event.slug}`)}
        />
      )}

      <PurchaseOverlay open={publishFlow.publishing} checking={publishFlow.checkingOutcome} />
    </div>
  );
}
