import { AlertTriangle, RefreshCw } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";

// Pantalla de error única para todo el Wizard (carga del evento o pago
// fallido) — nunca un alert(), nunca texto técnico crudo: `message` ya
// viene traducido por AppError del lado del backend, o por los mensajes
// propios de usePublishFlow (timeout/no confirmado).
export default function ErrorStep({ message, onRetry, retryLabel = "Intentar nuevamente", onBackToEvent }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
          <AlertTriangle className="h-9 w-9 text-rose-400" />
        </div>
        <h2 className="text-lg font-bold text-white">Algo salió mal</h2>
        <p className="text-sm text-slate-400">{message}</p>

        <div className="mt-4 flex w-full flex-col gap-2">
          {onRetry && (
            <Button onClick={onRetry} className="w-full justify-center">
              <RefreshCw className="h-4 w-4" />
              {retryLabel}
            </Button>
          )}
          <Button variant="secondary" onClick={onBackToEvent} className="w-full justify-center">
            Volver al evento
          </Button>
        </div>
      </div>
    </Card>
  );
}
