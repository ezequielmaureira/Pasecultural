import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import Button from "../../components/ui/Button.jsx";
import { apiFetch } from "../../lib/api.js";

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const slug = searchParams.get("slug");
  const functionId = searchParams.get("functionId");

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quantities, setQuantities] = useState({});
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch(`/api/events/public/${slug}`)
      .then(({ event }) => {
        if (!cancelled) setEvent(event);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(err.message || "No pudimos cargar el evento");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function updateQuantity(ticketTypeId, value) {
    setQuantities((q) => ({ ...q, [ticketTypeId]: Math.max(0, Number(value) || 0) }));
  }

  async function handlePurchase() {
    setError("");
    const items = Object.entries(quantities)
      .map(([ticketTypeId, qty]) => ({ ticketTypeId, quantity: Number(qty) }))
      .filter((it) => it.quantity > 0);

    if (!event || items.length === 0) {
      setError("Seleccioná al menos una entrada");
      return;
    }

    setProcessing(true);
    try {
      const token = await getToken();
      const { sale } = await apiFetch("/api/sales", {
        token,
        method: "POST",
        body: JSON.stringify({ eventId: event.id, functionId, items }),
      });

      // Simular pago aprobado: confirmar la venta en el backend como comprador.
      await apiFetch(`/api/sales/${sale.id}/confirm-by-buyer`, {
        token,
        method: "POST",
      });

      navigate("/mis-entradas");
    } catch (err) {
      console.error(err);
      setError(err.message || "Ocurrió un error al procesar la compra");
    } finally {
      setProcessing(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-slate-400">Cargando checkout...</div>;

  if (error && !event) return <div className="py-20 text-center text-rose-400">{error}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-white mb-2">Comprar entradas</h1>
      <p className="text-sm text-slate-400 mb-6">{event?.title}</p>

      <div className="space-y-4">
        {event?.ticketTypes?.map((tt) => (
          <div key={tt.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B1120] p-3">
            <div>
              <div className="text-sm font-semibold text-white">{tt.name}</div>
              <div className="text-xs text-slate-400">${tt.price}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={99}
                value={quantities[tt.id] ?? 0}
                onChange={(e) => updateQuantity(tt.id, e.target.value)}
                className="w-20 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white"
              />
            </div>
          </div>
        ))}
      </div>

      {error && event && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <div className="mt-6">
        <Button loading={processing} onClick={handlePurchase} size="lg">
          Confirmar compra y simular pago aprobado
        </Button>
      </div>
    </div>
  );
}
