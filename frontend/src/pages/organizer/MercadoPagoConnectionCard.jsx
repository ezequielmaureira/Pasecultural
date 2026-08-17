import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";
import { Landmark, CheckCircle2 } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { getMercadoPagoStatus, startMercadoPagoConnect } from "../../lib/mercadoPagoApi.js";
import { useToast } from "../../context/ToastContext.jsx";

// MP-1 — onboarding OAuth de Mercado Pago. Reemplaza el placeholder
// "Próximamente" que había en esta misma tarjeta. SÓLO conecta la cuenta:
// no hay configuración de comisión, movimientos, saldos ni checkout
// todavía (eso es MP-2) — a propósito no se agrega nada de eso acá.
export default function MercadoPagoConnectionCard({ organizationId }) {
  const { getToken } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // { connected, connectedAt, liveMode }
  const [statusError, setStatusError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  async function loadStatus() {
    if (!organizationId) return;
    try {
      const token = await getToken();
      const result = await getMercadoPagoStatus(token, organizationId);
      setStatus(result);
      setStatusError("");
    } catch (err) {
      setStatusError(err.message || "No pudimos consultar el estado de Mercado Pago.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  // Retorno del callback de OAuth (?mercadopago=success|error&...) — se
  // procesa UNA sola vez al montar, y se limpia la URL enseguida para que
  // un refresh de la página no vuelva a disparar el toast.
  useEffect(() => {
    const result = searchParams.get("mercadopago");
    if (!result) return;

    if (result === "success") {
      toast.success("Mercado Pago conectado correctamente.");
      loadStatus();
    } else if (result === "error") {
      const reason = searchParams.get("reason");
      toast.error(reason === "MERCADOPAGO_STATE_EXPIRED" ? "El intento de conexión venció. Probá de nuevo." : "No pudimos conectar Mercado Pago. Probá de nuevo.");
    }

    const next = new URLSearchParams(searchParams);
    next.delete("mercadopago");
    next.delete("reason");
    next.delete("organizationId");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setConnectError("");
    try {
      const token = await getToken();
      const { authorizationUrl } = await startMercadoPagoConnect(token, organizationId);
      // Navegación real de nivel superior hacia Mercado Pago — nunca
      // dentro de la llamada fetch (ver el informe de entrega de MP-1).
      window.location.href = authorizationUrl;
    } catch (err) {
      setConnectError(err.message || "No pudimos iniciar la conexión con Mercado Pago.");
      setConnecting(false);
    }
  }

  const connected = status?.connected ?? false;
  const connectedDateLabel = status?.connectedAt
    ? new Date(status.connectedAt).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  return (
    <Card title="Mercado Pago">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
            {connected ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Landmark className="h-5 w-5 text-slate-500" />}
          </div>
          <div>
            {loading ? (
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
            ) : connected ? (
              <>
                <p className="text-sm font-medium text-white">Estado: Conectado</p>
                {connectedDateLabel && <p className="text-xs text-slate-500">Vinculado el {connectedDateLabel}</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-white">Estado: No conectado</p>
                <p className="text-xs text-slate-500">Conectá tu cuenta para poder cobrar directamente desde Mercado Pago.</p>
              </>
            )}
          </div>
        </div>
        {!loading && !connected && (
          <Button variant="secondary" size="sm" onClick={handleConnect} loading={connecting} loadingText="Redirigiendo...">
            Conectar Mercado Pago
          </Button>
        )}
      </div>
      {statusError && <p className="mt-2 text-xs text-rose-400">{statusError}</p>}
      {connectError && <p className="mt-2 text-xs text-rose-400">{connectError}</p>}
    </Card>
  );
}
