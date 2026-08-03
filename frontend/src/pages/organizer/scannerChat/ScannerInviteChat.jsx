import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ArrowLeft, ArrowRight, PartyPopper } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Button from "../../../components/ui/Button.jsx";
import Spinner from "../../../components/ui/Spinner.jsx";
import { Field, inputClass } from "../../../components/ui/FormField.jsx";
import { listActiveEventsForScanner, createScannerInvitations } from "../../../lib/eventScannerApi.js";
import SingleSelectCards from "../eventChat/answerInputs/SingleSelectCards.jsx";
import { GATE_PRESETS } from "./GATE_PRESETS.js";
import ShareInvitationCard from "./ShareInvitationCard.jsx";

// Asistente conversacional para invitar scanners — misma filosofía visual
// que el motor de creación de eventos (una pregunta a la vez, animación de
// entrada `event-chat-question`, tarjetas seleccionables reutilizadas de
// SingleSelectCards) pero SIN el motor genérico de conversación
// (EventCreationEngine/ConversationState): son sólo 3 preguntas fijas, sin
// secciones, sin GOTO, sin necesidad de retomar entre sesiones/canales —
// construir esa máquina completa para esto sería más código que el
// problema que resuelve. El estado vive acá, en memoria del navegador.
export default function ScannerInviteChat({ onDone }) {
  const { getToken } = useAuth();

  // loading -> event -> gate -> gate-custom -> quantity -> generating -> share | error
  const [step, setStep] = useState("loading");
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [gate, setGate] = useState("");
  const [customGate, setCustomGate] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [created, setCreated] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const list = await listActiveEventsForScanner(token);
        if (cancelled) return;
        setEvents(list);
        if (list.length === 1) {
          setSelectedEventId(list[0].id);
          setStep("gate");
        } else {
          setStep("event");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "No pudimos cargar tus eventos.");
          setStep("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectEvent(eventId) {
    setSelectedEventId(eventId);
    setStep("gate");
  }

  function handleSelectGate(presetId) {
    if (presetId === "custom") {
      setStep("gate-custom");
      return;
    }
    const preset = GATE_PRESETS.find((p) => p.id === presetId);
    setGate(preset.label);
    setStep("quantity");
  }

  function handleConfirmCustomGate() {
    if (!customGate.trim()) return;
    setGate(customGate.trim());
    setStep("quantity");
  }

  async function handleConfirmQuantity() {
    setStep("generating");
    setError("");
    try {
      const token = await getToken();
      const scanners = await createScannerInvitations(token, selectedEventId, { gate, quantity });
      setCreated(scanners);
      setStep("share");
    } catch (err) {
      setError(err.message || "No pudimos generar la invitación.");
      setStep("quantity");
    }
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  if (step === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (step === "error") {
    return <p className="text-center text-sm text-rose-400">{error}</p>;
  }

  if (step === "share") {
    return (
      <div className="flex w-full flex-1 flex-col items-center gap-4 py-8">
        <div className="event-chat-question flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <PartyPopper className="h-10 w-10 text-violet-400" />
          <h1 className="text-xl font-semibold text-white sm:text-2xl">
            {created.length === 1
              ? "¡Listo! Compartí esta invitación."
              : `¡Listo! Generamos ${created.length} invitaciones para "${gate}".`}
          </h1>
          <p className="text-sm text-slate-400">
            Cada una tiene su propio enlace. Van a quedar como "pendiente de aprobación" hasta que aceptes su
            solicitud desde la lista de scanners.
          </p>

          <div className="flex w-full flex-col gap-3">
            {created.map((scanner) => (
              <ShareInvitationCard key={scanner.id} scanner={scanner} />
            ))}
          </div>

          <Button onClick={onDone} className="mt-2">
            Ir a la lista de scanners
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 py-8">
      <div key={step} className="event-chat-question flex w-full max-w-xl flex-col items-center gap-4">
        {step !== "event" && (
          <button
            type="button"
            onClick={() => {
              if (step === "gate" || step === "gate-custom") setStep(events.length > 1 ? "event" : "gate");
              else if (step === "quantity") setStep(gate && GATE_PRESETS.some((p) => p.label === gate) ? "gate" : "gate-custom");
            }}
            className="flex min-h-[40px] items-center gap-1.5 self-start rounded-lg px-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
        )}

        {step === "event" && (
          <>
            <h1 className="text-center text-xl font-semibold text-white sm:text-2xl">
              ¿Para qué evento querés agregar un scanner?
            </h1>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <SingleSelectCards
              options={events.map((e) => ({ id: e.id, label: e.title }))}
              onSubmit={handleSelectEvent}
            />
          </>
        )}

        {step === "gate" && (
          <>
            <h1 className="text-center text-xl font-semibold text-white sm:text-2xl">¿Qué función va a cubrir?</h1>
            <p className="text-sm text-slate-500">{selectedEvent?.title}</p>
            <SingleSelectCards options={GATE_PRESETS} onSubmit={handleSelectGate} />
          </>
        )}

        {step === "gate-custom" && (
          <>
            <h1 className="text-center text-xl font-semibold text-white sm:text-2xl">¿Cómo la llamamos?</h1>
            <Field label="Nombre de la puerta o acceso" className="w-full max-w-sm">
              <input
                autoFocus
                type="text"
                className={inputClass}
                value={customGate}
                onChange={(e) => setCustomGate(e.target.value)}
                placeholder="Ej. Puerta lateral"
                onKeyDown={(e) => e.key === "Enter" && handleConfirmCustomGate()}
              />
            </Field>
            <Button disabled={!customGate.trim()} onClick={handleConfirmCustomGate}>
              Continuar
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        )}

        {step === "quantity" && (
          <>
            <h1 className="text-center text-xl font-semibold text-white sm:text-2xl">
              ¿Cuántos scanners necesitás para "{gate}"?
            </h1>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <Field label="Cantidad" className="w-full max-w-[160px]">
              <input
                type="number"
                min={1}
                max={20}
                className={`${inputClass} text-center`}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </Field>
            <Button onClick={handleConfirmQuantity}>
              Generar invitación
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
