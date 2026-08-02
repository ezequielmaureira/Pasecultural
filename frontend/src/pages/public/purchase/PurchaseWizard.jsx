import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import StepIndicator from "../../../components/ui/StepIndicator.jsx";
import { usePublishFlow } from "../../../hooks/usePublishFlow.js";
import { apiFetch } from "../../../lib/api.js";
import { getSaleStatus } from "../../../lib/saleApi.js";
import { processPayment, checkPaymentOutcome } from "../../../lib/payment/paymentGateway.js";
import PurchaseOverlay from "./PurchaseOverlay.jsx";
import SelectFunctionStep from "./steps/SelectFunctionStep.jsx";
import SelectTicketsStep from "./steps/SelectTicketsStep.jsx";
import SummaryStep from "./steps/SummaryStep.jsx";
import BuyerInfoStep from "./steps/BuyerInfoStep.jsx";
import SuccessStep from "./steps/SuccessStep.jsx";
import ErrorStep from "./steps/ErrorStep.jsx";

const UNRESOLVED_PURCHASE_MESSAGE =
  "No pudimos confirmar si tu compra se completó. Revisá tu email antes de volver a intentar para no comprar dos veces.";

const EMPTY_BUYER = { firstName: "", lastName: "", email: "" };

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
    }));
}

// Reemplaza por completo a Checkout.jsx/Payment.jsx. El pago en sí es una
// caja negra para este componente — sólo llama a processPayment() (ver
// lib/payment/paymentGateway.js). El día que se integre Mercado Pago,
// cambia esa función; este Wizard no se toca.
export default function PurchaseWizard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = searchParams.get("slug");
  // Id persistente de la venta en curso, viajando en la URL (no sólo en
  // estado de React) — sobrevive a una recarga de página o, el día de
  // mañana, a un redirect real de vuelta desde Mercado Pago.
  const resumeSaleId = searchParams.get("saleId");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [event, setEvent] = useState(null);

  // "function" | "tickets" | "summary" | "buyer-info" | "success" | "purchase-error"
  const [phase, setPhase] = useState("tickets");
  const [selectedFunctionId, setSelectedFunctionId] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchasedTickets, setPurchasedTickets] = useState([]);

  // Mientras haya un saleId en la URL sin resolver todavía, ninguna otra
  // pantalla se muestra: primero se confirma contra el backend si esa venta
  // ya está pagada antes de dejar arrancar (o reiniciar) el Wizard.
  const [resolvingSale, setResolvingSale] = useState(Boolean(resumeSaleId));
  const [resolveError, setResolveError] = useState("");

  const publishFlow = usePublishFlow();

  const resolveExistingSale = useCallback(async () => {
    if (!resumeSaleId) return;
    setResolvingSale(true);
    setResolveError("");
    try {
      const result = await getSaleStatus(resumeSaleId);
      if (result?.status === "CONFIRMED" && Array.isArray(result.tickets) && result.tickets.length > 0) {
        setPurchasedTickets(result.tickets);
        setPhase("success");
      } else {
        // No hay nada que retomar (venta ajena, vencida, o todavía
        // PENDING): se limpia el saleId de la URL y el Wizard arranca de
        // cero en vez de quedar bloqueado esperando algo que no va a llegar.
        const next = new URLSearchParams(searchParams);
        next.delete("saleId");
        setSearchParams(next, { replace: true });
      }
    } catch (err) {
      setResolveError(err.message || "No pudimos recuperar tu compra.");
    } finally {
      setResolvingSale(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSaleId]);

  useEffect(() => {
    resolveExistingSale();
  }, [resolveExistingSale]);

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
      if (!data) {
        setLoadError("Este evento no existe o ya no está disponible.");
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
  // compra ya confirmada por recuperar. No depende de `event` — los tickets
  // que trae /status ya vienen con todo lo que necesita SuccessStep.
  if (resolvingSale) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Recuperando tu compra...</p>
      </div>
    );
  }

  if (resolveError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorStep
          message={resolveError}
          onRetry={resolveExistingSale}
          onBackToEvent={() => navigate(slug ? `/evento/${slug}` : "/eventos")}
        />
      </div>
    );
  }

  // También antes que la carga del evento: una compra ya resuelta (por
  // resolveExistingSale, o por handleConfirmPurchase más abajo) se muestra
  // igual aunque `event`/`slug` no estén disponibles — SuccessStep no
  // depende de ninguno de los dos, todo lo que necesita ya vino en `tickets`.
  if (phase === "success") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <SuccessStep tickets={purchasedTickets} buyerEmail={buyer.email} onKeepExploring={() => navigate("/eventos")} />
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
      <div className="mx-auto max-w-md px-4 py-16">
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
    return {
      ticketTypeId,
      name: option?.name ?? "",
      quantity,
      unitPrice: option?.price ?? 0,
      subtotal: (option?.price ?? 0) * quantity,
    };
  });
  const total = lineItems.reduce((sum, item) => sum + item.subtotal, 0);

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
    setQuantities((prev) => ({ ...prev, [ticketTypeId]: Math.max(0, (prev[ticketTypeId] ?? 0) + delta) }));
  }

  // Nunca pasa por Clerk: ni token, ni getAuth, ni isSignedIn. La identidad
  // del comprador es exactamente lo que completó en BuyerInfoStep.
  async function handleConfirmPurchase() {
    setPurchaseError("");
    let createdSaleId = null;

    const action = () => {
      console.log("PurchaseWizard.handleConfirmPurchase action starting", {
        eventId: event.id,
        functionId: selectedFunctionId,
        items,
        buyer,
      });
      return processPayment(
        { eventId: event.id, functionId: selectedFunctionId, items, buyer },
        {
          onSaleCreated: (id) => {
            createdSaleId = id;
            // El saleId se refleja en la URL apenas se conoce — no sólo en
            // esta variable local — para que una recarga de página (o el
            // día de mañana, el redirect real de vuelta desde Mercado Pago)
            // pueda retomar esta misma compra en vez de perderla.
            const next = new URLSearchParams(searchParams);
            next.set("saleId", id);
            setSearchParams(next, { replace: true });
          },
        }
      );
    };

    const checkOutcome = () => checkPaymentOutcome({ saleId: createdSaleId });

    try {
      console.log("PurchaseWizard.handleConfirmPurchase before publishFlow.run", { createdSaleId, items, buyer });
      const result = await publishFlow.run(action, { checkOutcome, unresolvedMessage: UNRESOLVED_PURCHASE_MESSAGE });
      console.log("PurchaseWizard.handleConfirmPurchase after publishFlow.run", { createdSaleId, result });
      // result.tickets viene siempre que la venta terminó CONFIRMED, sea que
      // processPayment() haya resuelto directo (confirm-by-buyer) o que se
      // haya recuperado por timeout (checkPaymentOutcome -> GET /status,
      // que ahora también devuelve los tickets una vez confirmada).
      setPurchasedTickets(result?.tickets ?? []);
      setPhase("success");
    } catch (err) {
      console.error("PurchaseWizard.handleConfirmPurchase caught error", err);
      console.error(err.response);
      console.error(err.data);
      console.error(err.stack);
      setPurchaseError(err.message || "No pudimos procesar tu compra.");
      setPhase("purchase-error");
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
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
          total={total}
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
