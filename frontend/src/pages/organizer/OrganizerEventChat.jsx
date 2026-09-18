import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PartyPopper, ArrowRight, Sparkles } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import ConversationView from "./eventChat/ConversationView.jsx";

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
  const [result, setResult] = useState(null);

  // `location.state` sólo existe cuando se navegó acá explícitamente por un
  // <Link>/navigate con `state` (Sidebar, OrganizerEvents.jsx) — un F5 en
  // medio de la creación lo pierde por completo (queda `null`), y ESE es
  // justo el caso que tiene que sobrevivir leyendo sessionStorage en vez de
  // reiniciar en false. Cuando SÍ hay `state` (cualquier navegación nueva,
  // incluida "Crear evento" del Sidebar que nunca manda `tutorial`), el
  // valor explícito manda siempre — así "Crear evento" entra sin tutorial
  // por más que la sesión anterior lo hubiera dejado prendido.
  const [tutorialEnabled, setTutorialEnabled] = useState(() => {
    const hasNavigationState = location.state != null;
    const initial = hasNavigationState
      ? location.state?.tutorial === true
      : readStoredTutorialEnabled() === "true";
    writeStoredTutorialEnabled(initial);
    return initial;
  });

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
