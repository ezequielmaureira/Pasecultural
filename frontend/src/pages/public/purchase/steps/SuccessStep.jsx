import { CheckCircle2 } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";

// No depende de la respuesta del pago (que puede venir de dos formas
// distintas según haya resuelto processPayment() directo o la
// recuperación por timeout, ver paymentGateway.js) — sólo confirma que se
// completó. El detalle real de las entradas se ve en Mis Entradas.
export default function SuccessStep({ onViewTickets, onKeepExploring }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-white">¡Compra realizada con éxito!</h2>
        <p className="text-sm text-slate-400">
          Tus entradas ya están disponibles.
        </p>

        <div className="mt-4 flex w-full flex-col gap-2">
          <Button onClick={onViewTickets} className="w-full justify-center">
            Ver mis entradas
          </Button>
          <Button variant="secondary" onClick={onKeepExploring} className="w-full justify-center">
            Seguir explorando eventos
          </Button>
        </div>
      </div>
    </Card>
  );
}
