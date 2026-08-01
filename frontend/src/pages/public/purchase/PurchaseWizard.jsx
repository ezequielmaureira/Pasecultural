import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ArrowLeft } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import StepIndicator from "../../../components/ui/StepIndicator.jsx";
import { usePublishFlow } from "../../../hooks/usePublishFlow.js";
import { apiFetch } from "../../../lib/api.js";
import { processPayment, checkPaymentOutcome } from "../../../lib/payment/paymentGateway.js";
import PurchaseOverlay from "./PurchaseOverlay.jsx";
import SelectFunctionStep from "./steps/SelectFunctionStep.jsx";
import SelectTicketsStep from "./steps/SelectTicketsStep.jsx";
import SummaryStep from "./steps/SummaryStep.jsx";
import SuccessStep from "./steps/SuccessStep.jsx";
import ErrorStep from "./steps/ErrorStep.jsx";

const UNRESOLVED_PURCHASE_MESSAGE =
  "No pudimos confirmar si tu compra se completó. Revisá \"Mis entradas\" antes de volver a intentar para no comprar dos veces.";

function buildSteps(hasMultipleFunctions) {
  const steps = [];
  let id = 1;
  if (hasMultipleFunctions) steps.push({ id: id++, label: "Función" });
  steps.push({ id: id++, label: "Entradas" });
  steps.push({ id, label: "Resumen" });
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const slug = searchParams.get("slug");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [event, setEvent] = useState(null);

  // "function" | "tickets" | "summary" | "success" | "purchase-error"
  const [phase, setPhase] = useState("tickets");
  const [selectedFunctionId, setSelectedFunctionId] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [purchaseError, setPurchaseError] = useState("");

  const publishFlow = usePublishFlow();

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
      : stepIdByLabel["Resumen"];

  function handleQuantityChange(ticketTypeId, delta) {
    setQuantities((prev) => ({ ...prev, [ticketTypeId]: Math.max(0, (prev[ticketTypeId] ?? 0) + delta) }));
  }

  async function handleConfirmPurchase() {
    setPurchaseError("");
    let createdSaleId = null;

    const action = async () => {
      const token = await getToken();
      return processPayment(
        token,
        { eventId: event.id, functionId: selectedFunctionId, items },
        { onSaleCreated: (id) => { createdSaleId = id; } }
      );
    };

    const checkOutcome = async () => {
      const token = await getToken();
      return checkPaymentOutcome(token, { eventId: event.id, functionId: selectedFunctionId, saleId: createdSaleId });
    };

    try {
      await publishFlow.run(action, { checkOutcome, unresolvedMessage: UNRESOLVED_PURCHASE_MESSAGE });
      setPhase("success");
    } catch (err) {
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
          onConfirm={handleConfirmPurchase}
        />
      )}

      {phase === "success" && (
        <SuccessStep
          onViewTickets={() => navigate("/mis-entradas")}
          onKeepExploring={() => navigate("/eventos")}
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
