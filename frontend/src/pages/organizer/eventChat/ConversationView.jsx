import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";
import {
  startConversation,
  replyConversation,
  getConversation,
  getConversationStatus,
  cancelConversation,
} from "../../../lib/conversationApi.js";
import { apiFetch } from "../../../lib/api.js";
import ConfirmDialog from "../../../components/ui/ConfirmDialog.jsx";
import PublishOverlay from "../../../components/ui/PublishOverlay.jsx";
import { usePublishFlow } from "../../../hooks/usePublishFlow.js";
import { useToast } from "../../../context/ToastContext.jsx";
import { NEW_EVENT_REQUEST_EVENT } from "../../../lib/eventChatEvents.js";
import SectionsNav from "./SectionsNav.jsx";
import QuestionRenderer from "./QuestionRenderer.jsx";
import PreviewCard from "./PreviewCard.jsx";

const STORAGE_KEY = "pasecultural:eventChat:conversationId";

// Dueño del estado de la conversación. No decide el siguiente paso: sólo
// guarda el último `prompt` que devolvió el Event Creation Engine y lo
// vuelve a mandar a QuestionRenderer/PreviewCard. El draftEvent nunca se
// reconstruye acá — sólo se ve cuando llega dentro de un prompt PREVIEW.
export default function ConversationView({ onDone }) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const startFresh = Boolean(location.state?.fresh);
  const [conversationId, setConversationId] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { publishing, setPublishing, checkingOutcome, confirmAfterTimeout } = usePublishFlow();
  const [loadError, setLoadError] = useState("");
  const [lastSocialNetwork, setLastSocialNetwork] = useState(null);
  const [categories, setCategories] = useState([]);
  const [canGoBack, setCanGoBack] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const questionRef = useRef(null);

  // Única responsable de arrancar una conversación completamente nueva:
  // la usan tanto el primer ingreso a "Crear evento" como cualquier reinicio
  // posterior (resume inválido, o el usuario pidiendo empezar de nuevo desde
  // acá mismo), así que ambos casos quedan garantizados de comportarse
  // exactamente igual. Limpia por completo el estado local de la
  // conversación anterior (mensajes, borrador, imagen/ubicación/funciones/
  // entradas cargadas hasta el momento — vive en `prompt`/`draftEvent` del
  // lado servidor, así que reemplazar `prompt` acá ya descarta esos datos
  // del lado cliente) antes de pedir una conversación nueva al motor.
  async function beginNewConversation({ discardPreviousId } = {}) {
    setLoading(true);
    setLoadError("");
    try {
      const token = await getToken();

      if (discardPreviousId) {
        try {
          await cancelConversation(token, discardPreviousId);
        } catch {
          // Si ya no existe o no se puede cancelar, no bloquea el inicio
          // de la conversación nueva.
        }
      }

      sessionStorage.removeItem(STORAGE_KEY);
      const result = await startConversation(token);

      sessionStorage.setItem(STORAGE_KEY, result.conversationId);
      setConversationId(result.conversationId);
      setPrompt(result.prompt);
      setCanGoBack(Boolean(result.canGoBack));
      setSections(result.sections ?? []);
      setLastSocialNetwork(null);
      setSubmitting(false);
      setPublishing(false);
      setShowDiscardDialog(false);
      setShowRestartDialog(false);
    } catch (err) {
      setLoadError(err.message || "No pudimos iniciar la conversación.");
    } finally {
      setLoading(false);
    }
  }

  // "Ya hay un evento en progreso" = se contestó al menos una pregunta
  // (canGoBack) o se llegó al preview final — en ambos casos hay algo que
  // se perdería al reiniciar. Si todavía está en la primera pregunta sin
  // tocar nada, reiniciar no pierde ningún dato real: no hace falta
  // interrumpir con un diálogo de confirmación.
  function requestNewConversation() {
    const hasProgress = canGoBack || prompt?.type === "PREVIEW";
    if (!hasProgress) {
      beginNewConversation({ discardPreviousId: conversationId });
      return;
    }
    setShowRestartDialog(true);
  }

  async function handleConfirmRestart() {
    setRestarting(true);
    await beginNewConversation({ discardPreviousId: conversationId });
    setRestarting(false);
    toast.success("Empezamos un evento nuevo.");
  }

  useEffect(() => {
    window.addEventListener(NEW_EVENT_REQUEST_EVENT, requestNewConversation);
    return () => window.removeEventListener(NEW_EVENT_REQUEST_EVENT, requestNewConversation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGoBack, prompt, conversationId]);

  async function handleDiscard() {
    setDiscarding(true);
    try {
      const token = await getToken();
      if (conversationId) await cancelConversation(token, conversationId);
      sessionStorage.removeItem(STORAGE_KEY);
      toast.success("Borrador descartado.");
      navigate("/organizador/eventos");
    } catch (err) {
      setDiscarding(false);
      setShowDiscardDialog(false);
      setPrompt((prev) => ({ ...prev, error: err.message || "No pudimos descartar el borrador." }));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const token = await getToken();
        const { categories: cats } = await apiFetch("/api/events/categories", { token });
        if (cancelled) return;
        setCategories(cats);

        const savedId = sessionStorage.getItem(STORAGE_KEY);

        if (savedId && startFresh) {
          // "Crear evento" desde el menú/listado: el usuario quiere arrancar
          // de cero, no retomar un borrador conversacional en el que había
          // quedado a mitad de camino en una visita anterior.
          if (!cancelled) await beginNewConversation({ discardPreviousId: savedId });
          return;
        }

        if (savedId) {
          try {
            const result = await getConversation(token, savedId);
            if (cancelled) return;
            sessionStorage.setItem(STORAGE_KEY, result.conversationId);
            setConversationId(result.conversationId);
            setPrompt(result.prompt);
            setCanGoBack(Boolean(result.canGoBack));
            setSections(result.sections ?? []);
            setLoading(false);
          } catch {
            // La conversación guardada ya no es válida (ej. quedó parada en
            // un paso que el motor eliminó/renombró): se descarta y arranca
            // una nueva en vez de dejar al usuario trabado con un error.
            if (!cancelled) await beginNewConversation();
          }
          return;
        }

        if (!cancelled) await beginNewConversation();
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "No pudimos iniciar la conversación.");
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    questionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [prompt?.stepId]);

  async function send(body) {
    const isPublish = body.action === "PUBLISH";
    const isPersistAction = isPublish || body.action === "DRAFT";
    setSubmitting(true);
    if (isPublish) setPublishing(true);
    try {
      const token = await getToken();
      const result = await replyConversation(token, conversationId, body);

      if (result.done) {
        sessionStorage.removeItem(STORAGE_KEY);
        onDone(result);
        return;
      }

      setPrompt(result.prompt);
      setCanGoBack(Boolean(result.canGoBack));
      setSections(result.sections ?? []);
    } catch (err) {
      if (isPersistAction && err.isTimeout) {
        // El fetch se abortó por timeout, pero el backend puede haber
        // terminado igual (ver EventCreationEngine.getStatus) — en vez de
        // asumir que falló, se confirma el estado real antes de decirle
        // cualquier cosa al usuario.
        const outcome = await confirmAfterTimeout(async () => {
          const checkToken = await getToken();
          const status = await getConversationStatus(checkToken, conversationId);
          if (status.status === "ACTIVE" || !status.eventId) return null;
          const { event } = await apiFetch(`/api/events/${status.eventId}`, { token: checkToken });
          return { done: true, status: status.status, event };
        });
        if (outcome) {
          sessionStorage.removeItem(STORAGE_KEY);
          onDone(outcome);
          return;
        }
        setPrompt((prev) => ({
          ...prev,
          error: "No pudimos confirmar si se guardó. Revisá la lista de tus eventos antes de reintentar para no duplicarlo.",
        }));
      } else {
        setPrompt((prev) => ({ ...prev, error: err.message || "Algo salió mal, intentá de nuevo." }));
      }
    } finally {
      setSubmitting(false);
      if (isPublish) setPublishing(false);
    }
  }

  function handleAnswer(value) {
    if (prompt.stepId === "SOCIAL_NETWORK") setLastSocialNetwork(value);
    send({ value });
  }

  function handleBack() {
    send({ action: "BACK" });
  }

  // Único punto de entrada del navegador de secciones: clickear una sección
  // ya alcanzada es, para el motor, exactamente lo mismo que "Editar" desde
  // el preview — un GOTO al primer paso de esa sección, sin tocar el resto
  // del evento (ver EventCreationEngine.handleGoto).
  function handleGoto(stepId) {
    send({ action: "GOTO", stepId });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (loadError) {
    return <p className="text-center text-sm text-rose-400">{loadError}</p>;
  }

  if (!prompt) return null;

  function resolveCategoryLabel() {
    if (prompt.type !== "PREVIEW") return null;
    if (prompt.draft.category === "OTRO") return prompt.draft.customCategory;
    return categories.find((c) => c.id === prompt.draft.category)?.label ?? prompt.draft.category;
  }
  const categoryLabel = resolveCategoryLabel();

  const discardButton = (
    <button
      type="button"
      onClick={() => setShowDiscardDialog(true)}
      className="flex min-h-[40px] items-center gap-1.5 self-end rounded-lg px-2 text-xs text-slate-500 transition-colors duration-150 hover:bg-rose-500/10 hover:text-rose-400"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Descartar borrador
    </button>
  );

  const discardDialog = showDiscardDialog && (
    <ConfirmDialog
      title="¿Descartar este borrador?"
      description="Se perderá toda la información ingresada hasta el momento."
      confirmLabel="Descartar"
      cancelLabel="Seguir editando"
      danger
      loading={discarding}
      onConfirm={handleDiscard}
      onClose={() => setShowDiscardDialog(false)}
    />
  );

  const restartDialog = showRestartDialog && (
    <ConfirmDialog
      title="¿Comenzar un nuevo evento?"
      description="Estás creando un evento. Si continuás, se descartará esta conversación y comenzarás una nueva."
      confirmLabel="Comenzar de nuevo"
      cancelLabel="Cancelar"
      danger
      loading={restarting}
      onConfirm={handleConfirmRestart}
      onClose={() => setShowRestartDialog(false)}
    />
  );

  if (prompt.type === "PREVIEW") {
    return (
      <div ref={questionRef} className="flex w-full flex-1 flex-col items-center gap-4 py-8">
        <SectionsNav sections={sections} onSelect={handleGoto} disabled={submitting} />
        {discardButton}
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            disabled={submitting}
            className="flex min-h-[40px] items-center gap-1.5 self-start rounded-lg px-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
        )}
        <PreviewCard
          draft={prompt.draft}
          categoryLabel={categoryLabel}
          submitting={submitting}
          publishing={publishing}
          error={prompt.error}
          onEdit={handleGoto}
          onSaveDraft={() => send({ action: "DRAFT" })}
          onPublish={() => send({ action: "PUBLISH" })}
        />
        {discardDialog}
        {restartDialog}
        <PublishOverlay open={publishing || checkingOutcome} checking={checkingOutcome} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 py-8">
      <SectionsNav sections={sections} onSelect={handleGoto} disabled={submitting} />
      {discardButton}

      <div
        key={`${conversationId}-${prompt.stepId}`}
        ref={questionRef}
        className="event-chat-question flex w-full max-w-xl flex-col items-center gap-4"
      >
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            disabled={submitting}
            className="flex min-h-[40px] items-center gap-1.5 self-start rounded-lg px-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
        )}
        <h1 className="text-center text-xl font-semibold text-white sm:text-2xl">{prompt.text}</h1>
        {prompt.error && <p className="text-sm text-rose-400">{prompt.error}</p>}
        <QuestionRenderer
          prompt={prompt}
          onSubmit={handleAnswer}
          disabled={submitting}
          context={{ lastSocialNetwork }}
        />
      </div>
      {discardDialog}
      {restartDialog}
    </div>
  );
}
