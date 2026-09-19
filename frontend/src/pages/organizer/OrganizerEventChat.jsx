import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PartyPopper, ArrowRight, Sparkles } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import ConversationView from "./eventChat/ConversationView.jsx";
import { NEW_EVENT_REQUEST_EVENT } from "../../lib/eventChatEvents.js";

// Sibling de STORAGE_KEY ("pasecultural:eventChat:conversationId", ver
// ConversationView.jsx) — mismo namespace/convención (raw string, sin
// JSON), pero un estado DISTINTO e independiente: prender/apagar el
// tutorial nunca toca conversationId ni dispara startConversation/GOTO/
// BACK. Sólo decide si ConversationView renderiza <TutorialSpotlight />.
const TUTORIAL_STORAGE_KEY = "pasecultural:eventChat:tutorialEnabled";

function readStoredTutorialEnabled() {
  try {
    return sessionStorage.getItem(TUTORIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTutorialEnabled(enabled) {
  try {
    sessionStorage.setItem(TUTORIAL_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // sessionStorage inaccesible: el toggle sigue funcionando en memoria
    // para esta sesión, sólo no sobrevive a un refresh.
  }
}

function SuccessScreen({ result }) {
  const isPublished = result.status === "PUBLISHED";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <PartyPopper className="h-10 w-10 text-violet-400" />
      <h1 className="text-2xl font-bold text-white">
        {isPublished ? "¡Tu evento ya está publicado!" : "Guardamos tu evento como borrador"}
      </h1>
      <p className="max-w-md text-sm text-slate-400">
        {isPublished
          ? "Ya está visible en el marketplace de Smarticket."
          : "Podés retomarlo y publicarlo cuando quieras desde el listado de eventos."}
      </p>
      <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:w-auto sm:flex-row">
        <Link to="/organizador/eventos" className="w-full sm:w-auto">
          <Button variant="secondary" className="w-full sm:w-auto">
            Ver mis eventos
          </Button>
        </Link>
        <Link to={`/organizador/eventos/${result.event.id}/editar`} className="w-full sm:w-auto">
          <Button className="w-full sm:w-auto">
            Seguir editando
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function OrganizerEventChat() {
  const location = useLocation();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);

  // `location.state.fresh` es el ÚNICO flag de "esto es una navegación
  // NUEVA" (Sidebar/OrganizerEvents.jsx siempre lo mandan junto con
  // cualquier `tutorial` — ver ambos call sites). A diferencia del state
  // de React, `history.state` (de donde sale `location.state`) puede
  // sobrevivir un F5 según el navegador — así que "existe location.state"
  // NO alcanza para distinguir una navegación nueva de una reanudación por
  // refresh (eso fue el bug: apagar el tutorial a mano, F5, y volver a leer
  // un `tutorial:true` viejo del history state). Fuera de una navegación
  // fresh, sessionStorage es la ÚNICA fuente de verdad.
  const [tutorialEnabled, setTutorialEnabled] = useState(() => {
    const isFreshNavigation = location.state?.fresh === true;
    const initial = isFreshNavigation
      ? location.state?.tutorial === true
      : readStoredTutorialEnabled() === "true";
    writeStoredTutorialEnabled(initial);
    return initial;
  });

  // Consume el history state de ESTA navegación una sola vez, al montar —
  // necesario para que el fix de arriba sea real: si no se limpia, un F5
  // futuro seguiría viendo el mismo `fresh:true`/`tutorial` de la
  // navegación original (el history state persiste más allá del ciclo de
  // vida del componente React) y el toggle manual volvería a perderse.
  // Nunca toca conversationId: ConversationView ya consumió
  // `location.state.fresh` en su propio efecto de montaje (corre antes que
  // este, por ser el hijo) antes de que este replace ocurra.
  useEffect(() => {
    if (location.state != null) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener SEPARADO del de ConversationView.jsx (que reacciona a este
  // mismo evento para reiniciar/confirmar la conversación — eso NO cambia
  // acá) — este sólo sincroniza el toggle visual con el onboarding que
  // decidió Sidebar.jsx (ver ese archivo: `detail.tutorial` viaja como
  // isFirstEvent en el momento del click). Nunca toca conversationId,
  // nunca llama startConversation/GOTO/BACK — sólo tutorialEnabled.
  useEffect(() => {
    function handleNewEventRequested(event) {
      const tutorial = event.detail?.tutorial;
      if (typeof tutorial !== "boolean") return;
      setTutorialEnabled(tutorial);
      writeStoredTutorialEnabled(tutorial);
    }
    window.addEventListener(NEW_EVENT_REQUEST_EVENT, handleNewEventRequested);
    return () => window.removeEventListener(NEW_EVENT_REQUEST_EVENT, handleNewEventRequested);
  }, []);

  function toggleTutorial() {
    setTutorialEnabled((prev) => {
      const next = !prev;
      writeStoredTutorialEnabled(next);
      return next;
    });
  }

  // El toggle es puramente visual — nunca toca conversationId/prompt (esos
  // viven enteramente dentro de ConversationView.jsx). Apagar el tutorial
  // acá arriba y volver a prenderlo no reinicia ni un solo campo de la
  // conversación en curso.
  function exitTutorial() {
    setTutorialEnabled(false);
    writeStoredTutorialEnabled(false);
  }

  return (
    <div className="flex min-h-[70vh] flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Crear evento</h1>
          <p className="text-sm text-slate-400">Respondé una pregunta a la vez, nosotros armamos el evento.</p>
        </div>
        {!result && (
          <button
            type="button"
            onClick={toggleTutorial}
            aria-pressed={tutorialEnabled}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all duration-200 ${
              tutorialEnabled
                ? "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-[0_0_16px_-4px_rgba(139,92,246,0.65)]"
                : "border border-violet-400/30 bg-transparent text-slate-300 hover:border-violet-400/50 hover:text-violet-200"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {tutorialEnabled ? "Tutorial activo" : "Crear con tutorial"}
          </button>
        )}
      </div>

      {result ? (
        <SuccessScreen result={result} />
      ) : (
        <ConversationView onDone={setResult} tutorialEnabled={tutorialEnabled} onExitTutorial={exitTutorial} />
      )}
    </div>
  );
}
