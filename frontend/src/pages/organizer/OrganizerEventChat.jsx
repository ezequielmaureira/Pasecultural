import { useState } from "react";
import { Link } from "react-router-dom";
import { PartyPopper, ArrowRight } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import ConversationView from "./eventChat/ConversationView.jsx";

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
          ? "Ya está visible en el marketplace de PaseCultural."
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
  const [result, setResult] = useState(null);

  return (
    <div className="flex min-h-[70vh] flex-1 flex-col">
      <div className="mb-2">
        <h1 className="text-xl font-bold text-white">Crear evento</h1>
        <p className="text-sm text-slate-400">Respondé una pregunta a la vez, nosotros armamos el evento.</p>
      </div>

      {result ? <SuccessScreen result={result} /> : <ConversationView onDone={setResult} />}
    </div>
  );
}
