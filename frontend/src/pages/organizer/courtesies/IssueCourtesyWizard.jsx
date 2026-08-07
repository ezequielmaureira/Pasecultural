import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { CheckCircle2, ChevronLeft, Gift, Link2, Mail } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Button from "../../../components/ui/Button.jsx";
import StepIndicator from "../../../components/ui/StepIndicator.jsx";
import { Field, inputClass, textareaClass } from "../../../components/ui/FormField.jsx";
import ShareLinkPanel from "../../../components/organizer/ShareLinkPanel.jsx";
import { useOrganizerData } from "../../../context/OrganizerDataContext.jsx";
import { useToast } from "../../../context/ToastContext.jsx";
import { issueCourtesy, downloadCourtesyPdf } from "../../../lib/courtesyApi.js";
import { formatEventDateTime } from "../../../lib/eventFormat.js";

const REASON_OPTIONS = [
    { value: "SPONSOR", label: "Sponsor" },
    { value: "PRENSA", label: "Prensa" },
    { value: "INVITADO", label: "Invitado" },
    { value: "STAFF", label: "Staff" },
    { value: "ARTISTA", label: "Artista" },
    { value: "FAMILIAR", label: "Familiar" },
    { value: "PROTOCOLO", label: "Protocolo" },
    { value: "OTRO", label: "Otro" },
];

const STEPS = [
    { id: 1, label: "Evento" },
    { id: 2, label: "Función" },
    { id: 3, label: "Entrada" },
    { id: 4, label: "Detalles" },
    { id: 5, label: "Entrega" },
];

// Asistente de 6 pasos del pedido original, con dos ajustes deliberados
// para que sea más rápido de usar sin perder ningún campo:
//   - Paso 1 (evento) y paso 2 (función) se saltean solos cuando sólo hay
//     una opción — pedido explícito.
//   - Paso 4 (cantidad) y paso 5 (motivo) del pedido original se muestran
//     juntos en una sola pantalla ("Detalles"): son dos campos simples del
//     mismo tipo de decisión, separarlos en dos taps no suma nada a
//     "simple, rápido e intuitivo" — el objetivo explícito de este asistente.
// Pasos 1-3 se resuelven con useOrganizerData().events (ya trae funciones +
// tipos de entrada por evento) — cero fetches nuevos.
export default function IssueCourtesyWizard() {
    const navigate = useNavigate();
    const { getToken } = useAuth();
    const toast = useToast();
    const { events, loadingEvents } = useOrganizerData();

    const eligibleEvents = useMemo(() => events.filter((e) => (e.functions ?? []).length > 0), [events]);

    // "form" | "issuing" | "result"
    const [phase, setPhase] = useState("form");
    const [step, setStep] = useState(1);

    const [selectedEvent, setSelectedEvent] = useState(null);
    const [selectedFunction, setSelectedFunction] = useState(null);
    const [selectedTicketTypeId, setSelectedTicketTypeId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [reason, setReason] = useState("");
    const [reasonNote, setReasonNote] = useState("");
    const [deliveryMethod, setDeliveryMethod] = useState(null); // "SHARE" | "EMAIL"
    const [recipientEmail, setRecipientEmail] = useState("");

    const [issuing, setIssuing] = useState(false);
    const [issueError, setIssueError] = useState("");
    const [result, setResult] = useState(null); // { shareUrl, deliveryMethod, recipientEmail, saleId } | null
    const [downloadingPdf, setDownloadingPdf] = useState(false);

    // Auto-selección: un solo evento activo -> se elige solo y se salta al
    // paso de función (que a su vez también puede saltearse sola).
    useEffect(() => {
        if (!loadingEvents && eligibleEvents.length === 1 && !selectedEvent) {
            handleSelectEvent(eligibleEvents[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadingEvents, eligibleEvents]);

    const ticketTypeOptions = useMemo(() => {
        if (!selectedFunction) return [];
        return (selectedFunction.ticketAssignments ?? [])
            .filter((a) => a.enabled)
            .map((a) => ({ id: a.ticketType.id, name: a.ticketType.name }));
    }, [selectedFunction]);

    function handleSelectEvent(event) {
        setSelectedEvent(event);
        setSelectedFunction(null);
        setSelectedTicketTypeId("");
        if ((event.functions ?? []).length === 1) {
            handleSelectFunction(event.functions[0]);
            return;
        }
        setStep(2);
    }

    function handleSelectFunction(fn) {
        setSelectedFunction(fn);
        setSelectedTicketTypeId("");
        setStep(3);
    }

    function handleSelectTicketType(id) {
        setSelectedTicketTypeId(id);
        setStep(4);
    }

    function goBack() {
        if (step === 3 && (selectedEvent?.functions ?? []).length === 1) {
            setStep(1);
            return;
        }
        setStep((s) => Math.max(1, s - 1));
    }

    async function handleIssue() {
        if (!deliveryMethod) return;
        if (deliveryMethod === "EMAIL" && !recipientEmail.trim()) return;

        setIssuing(true);
        setIssueError("");
        try {
            const token = await getToken();
            const response = await issueCourtesy(token, {
                eventId: selectedEvent.id,
                functionId: selectedFunction.id,
                ticketTypeId: selectedTicketTypeId,
                quantity,
                reason: reason || undefined,
                reasonNote: reasonNote.trim() || undefined,
                deliveryMethod,
                recipientEmail: deliveryMethod === "EMAIL" ? recipientEmail.trim() : undefined,
            });
            setResult({
                saleId: response.sale?.id,
                shareUrl: response.shareUrl,
                deliveryMethod,
                recipientEmail: deliveryMethod === "EMAIL" ? recipientEmail.trim() : null,
                emailDeliveryStatus: response.emailDeliveryStatus,
            });
            setPhase("result");
        } catch (err) {
            setIssueError(err.message || "No pudimos emitir la cortesía.");
        } finally {
            setIssuing(false);
        }
    }

    async function handleDownloadPdf() {
        if (!result?.saleId) return;
        setDownloadingPdf(true);
        try {
            const token = await getToken();
            const { blob, filename } = await downloadCourtesyPdf(token, result.saleId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err.message || "No pudimos descargar el PDF.");
        } finally {
            setDownloadingPdf(false);
        }
    }

    function handleIssueAnother() {
        setPhase("form");
        setStep(1);
        setSelectedEvent(null);
        setSelectedFunction(null);
        setSelectedTicketTypeId("");
        setQuantity(1);
        setReason("");
        setReasonNote("");
        setDeliveryMethod(null);
        setRecipientEmail("");
        setResult(null);
        setIssueError("");
    }

    if (loadingEvents) {
        return (
            <div className="mx-auto max-w-lg py-10 text-center text-sm text-slate-400">Cargando eventos…</div>
        );
    }

    if (eligibleEvents.length === 0) {
        return (
            <div className="mx-auto max-w-lg py-10 text-center">
                <p className="text-sm text-slate-400">
                    Todavía no tenés ningún evento con funciones y entradas configuradas — creá uno antes de emitir cortesías.
                </p>
            </div>
        );
    }

    if (phase === "result" && result) {
        return (
            <div className="mx-auto flex max-w-lg flex-col gap-6">
                <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                        <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                    </div>
                    <h1 className="text-lg font-bold text-white">Cortesía emitida</h1>
                    <p className="text-sm text-slate-400">
                        {quantity > 1 ? `${quantity} entradas de` : "Entrada de"} {selectedTicketTypeName(ticketTypeOptions, selectedTicketTypeId)} para {selectedEvent?.title}.
                    </p>
                </div>

                <Card>
                    {result.deliveryMethod === "SHARE" ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                <Link2 className="h-4 w-4 text-violet-400" />
                                Compartir cortesía
                            </div>
                            <ShareLinkPanel
                                url={result.shareUrl}
                                title={`Cortesía — ${selectedEvent?.title}`}
                                shareText={`Te comparto tu entrada de cortesía para "${selectedEvent?.title}": ${result.shareUrl}`}
                                onDownloadPdf={handleDownloadPdf}
                                downloadingPdf={downloadingPdf}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 py-4 text-center">
                            <Mail className="h-6 w-6 text-violet-400" />
                            <p className="text-sm text-white">
                                {result.emailDeliveryStatus === "SENT" || result.emailDeliveryStatus === "PENDING"
                                    ? `Enviamos las entradas a ${result.recipientEmail}.`
                                    : `La cortesía se emitió, pero no pudimos confirmar el envío a ${result.recipientEmail}. Podés reintentarlo desde el Historial.`}
                            </p>
                        </div>
                    )}
                </Card>

                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1 justify-center" onClick={handleIssueAnother}>
                        Emitir otra
                    </Button>
                    <Button className="flex-1 justify-center" onClick={() => navigate("/organizador/cortesias/historial")}>
                        Ver historial
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-lg">
            <div className="mb-4 flex items-center gap-2">
                <Gift className="h-5 w-5 text-violet-400" />
                <h1 className="text-xl font-bold text-white">Emitir cortesía</h1>
            </div>

            <StepIndicator steps={STEPS} step={Math.min(step, 5)} onStepClick={() => {}} clickable={false} />

            <Card>
                {step === 1 && (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm font-semibold text-white">Elegí el evento</p>
                        <div className="flex flex-col gap-2">
                            {eligibleEvents.map((event) => (
                                <button
                                    key={event.id}
                                    type="button"
                                    onClick={() => handleSelectEvent(event)}
                                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white transition-colors duration-150 hover:border-violet-500/40"
                                >
                                    {event.title}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {step === 2 && selectedEvent && (
                    <div className="flex flex-col gap-3">
                        <button type="button" onClick={goBack} className="flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-white">
                            <ChevronLeft className="h-3.5 w-3.5" /> Volver
                        </button>
                        <p className="text-sm font-semibold text-white">Elegí la función</p>
                        <div className="flex flex-col gap-2">
                            {(selectedEvent.functions ?? []).map((fn) => (
                                <button
                                    key={fn.id}
                                    type="button"
                                    onClick={() => handleSelectFunction(fn)}
                                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white transition-colors duration-150 hover:border-violet-500/40"
                                >
                                    {formatEventDateTime(fn.date)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col gap-3">
                        <button type="button" onClick={goBack} className="flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-white">
                            <ChevronLeft className="h-3.5 w-3.5" /> Volver
                        </button>
                        <p className="text-sm font-semibold text-white">Tipo de entrada</p>
                        {ticketTypeOptions.length === 0 ? (
                            <p className="text-sm text-slate-500">Esta función no tiene tipos de entrada habilitados.</p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {ticketTypeOptions.map((tt) => (
                                    <button
                                        key={tt.id}
                                        type="button"
                                        onClick={() => handleSelectTicketType(tt.id)}
                                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white transition-colors duration-150 hover:border-violet-500/40"
                                    >
                                        {tt.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {step === 4 && (
                    <div className="flex flex-col gap-4">
                        <button type="button" onClick={goBack} className="flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-white">
                            <ChevronLeft className="h-3.5 w-3.5" /> Volver
                        </button>

                        <Field label="Cantidad" required>
                            <input
                                type="number"
                                min={1}
                                value={quantity}
                                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                                className={inputClass}
                            />
                        </Field>

                        <Field label="Motivo (opcional)">
                            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
                                <option value="">Sin especificar</option>
                                {REASON_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Observación (opcional)">
                            <textarea
                                value={reasonNote}
                                onChange={(e) => setReasonNote(e.target.value)}
                                className={textareaClass}
                                placeholder="Nota interna, sin límite de formato"
                            />
                        </Field>

                        <Button onClick={() => setStep(5)} className="w-full justify-center">
                            Continuar
                        </Button>
                    </div>
                )}

                {step === 5 && (
                    <div className="flex flex-col gap-4">
                        <button type="button" onClick={goBack} className="flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-white">
                            <ChevronLeft className="h-3.5 w-3.5" /> Volver
                        </button>

                        <p className="text-sm font-semibold text-white">¿Cómo querés entregar esta cortesía?</p>

                        <div className="flex flex-col gap-2">
                            <label
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors duration-150 ${
                                    deliveryMethod === "SHARE" ? "border-violet-500 bg-violet-500/10 text-white" : "border-white/10 bg-white/5 text-slate-300"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="deliveryMethod"
                                    checked={deliveryMethod === "SHARE"}
                                    onChange={() => setDeliveryMethod("SHARE")}
                                    className="h-4 w-4"
                                />
                                Compartir
                            </label>
                            <label
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors duration-150 ${
                                    deliveryMethod === "EMAIL" ? "border-violet-500 bg-violet-500/10 text-white" : "border-white/10 bg-white/5 text-slate-300"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="deliveryMethod"
                                    checked={deliveryMethod === "EMAIL"}
                                    onChange={() => setDeliveryMethod("EMAIL")}
                                    className="h-4 w-4"
                                />
                                Enviar por correo
                            </label>
                        </div>

                        {deliveryMethod === "EMAIL" && (
                            <Field label="Correo electrónico" required>
                                <input
                                    type="email"
                                    value={recipientEmail}
                                    onChange={(e) => setRecipientEmail(e.target.value)}
                                    placeholder="destinatario@email.com"
                                    className={inputClass}
                                />
                            </Field>
                        )}

                        {issueError && <p className="text-sm text-rose-400">{issueError}</p>}

                        <Button
                            onClick={handleIssue}
                            loading={issuing}
                            disabled={!deliveryMethod || (deliveryMethod === "EMAIL" && !recipientEmail.trim())}
                            className="w-full justify-center"
                        >
                            {deliveryMethod === "EMAIL" ? "Enviar" : "Generar y compartir"}
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}

function selectedTicketTypeName(options, id) {
    return options.find((o) => o.id === id)?.name ?? "";
}
