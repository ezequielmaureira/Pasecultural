import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";
import {
  startConversation,
  replyConversation,
  getConversation,
  cancelConversation,
} from "../../../lib/conversationApi.js";
import { apiFetch } from "../../../lib/api.js";
import ConfirmDialog from "../../../components/ui/ConfirmDialog.jsx";
import ProgressHeader from "./ProgressHeader.jsx";
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
  const [conversationId, setConversationId] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastSocialNetwork, setLastSocialNetwork] = useState(null);
  const [categories, setCategories] = useState([]);
  const [canGoBack, setCanGoBack] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const questionRef = useRef(null);

  async function handleDiscard() {
    setDiscarding(true);
    try {
      const token = await getToken();
      if (conversationId) await cancelConversation(token, conversationId);
      sessionStorage.removeItem(STORAGE_KEY);
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
        const result = savedId
          ? await getConversation(token, savedId)
          : await startConversation(token);

        if (cancelled) return;
        sessionStorage.setItem(STORAGE_KEY, result.conversationId);
        setConversationId(result.conversationId);
        setPrompt(result.prompt);
        setCanGoBack(Boolean(result.canGoBack));
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "No pudimos iniciar la conversación.");
      } finally {
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
    setSubmitting(true);
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
    } catch (err) {
      setPrompt((prev) => ({ ...prev, error: err.message || "Algo salió mal, intentá de nuevo." }));
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnswer(value) {
    if (prompt.stepId === "SOCIAL_NETWORK") setLastSocialNetwork(value);
    send({ value });
  }

  function handleBack() {
    send({ action: "BACK" });
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
      className="flex items-center gap-1.5 self-end text-xs text-slate-500 transition-colors duration-150 hover:text-rose-400"
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

  if (prompt.type === "PREVIEW") {
    return (
      <div ref={questionRef} className="flex w-full flex-1 flex-col items-center gap-4 py-8">
        {discardButton}
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            disabled={submitting}
            className="flex items-center gap-1.5 self-start text-sm text-slate-400 transition-colors duration-150 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
        )}
        <PreviewCard
          draft={prompt.draft}
          categoryLabel={categoryLabel}
          submitting={submitting}
          error={prompt.error}
          onEdit={(stepId) => send({ action: "EDIT", stepId })}
          onSaveDraft={() => send({ action: "DRAFT" })}
          onPublish={() => send({ action: "PUBLISH" })}
        />
        {discardDialog}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 py-8">
      {discardButton}
      <ProgressHeader stepId={prompt.stepId} />

      <div
        key={prompt.stepId}
        ref={questionRef}
        className="event-chat-question flex w-full max-w-xl flex-col items-center gap-4"
      >
        {canGoBack && (
          <button
            type="button"
            onClick={handleBack}
            disabled={submitting}
            className="flex items-center gap-1.5 self-start text-sm text-slate-400 transition-colors duration-150 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
        )}
        <h1 className="text-center text-2xl font-semibold text-white">{prompt.text}</h1>
        {prompt.error && <p className="text-sm text-rose-400">{prompt.error}</p>}
        <QuestionRenderer
          prompt={prompt}
          onSubmit={handleAnswer}
          disabled={submitting}
          context={{ lastSocialNetwork }}
        />
      </div>
      {discardDialog}
    </div>
  );
}
