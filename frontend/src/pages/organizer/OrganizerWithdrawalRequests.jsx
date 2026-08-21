import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import Card from "../../components/ui/Card.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { formatDateTime, formatCurrencyARS } from "../../lib/format.js";
import { getWithdrawalRequests, updateWithdrawalRequestStatus } from "../../lib/withdrawalRequestApi.js";

// Botón de arrepentimiento — Organizer > Solicitudes. El backend
// (listWithdrawalRequestsService) ya filtra estrictamente por la
// organización del caller — esta pantalla nunca recibe ni manda ningún
// organizationId, no hay forma de manipular la URL para ver otra
// organización (ver el informe de entrega, sección "Aislamiento
// multi-organizador").
const REASON_LABEL = {
  ARREPENTIMIENTO: "Me arrepentí de la compra",
  ERROR_COMPRA: "Compré por error",
  CAMBIO_EVENTO: "Cambio/cancelación relacionada con el evento",
  PROBLEMA_ENTRADAS: "Problema con las entradas",
  OTRO: "Otro",
};

const STATUS_LABEL = {
  REQUESTED: "Registrada",
  CONTACTED: "Organizador notificado",
  RESOLVED: "Resuelta",
};

const STATUS_OPTIONS = ["REQUESTED", "CONTACTED", "RESOLVED"];

export default function OrganizerWithdrawalRequests() {
  const { getToken } = useAuth();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const list = await getWithdrawalRequests(token);
      setRequests(list ?? []);
    } catch (err) {
      console.error("No se pudieron cargar las solicitudes", err);
      setError(err.message || "No pudimos cargar las solicitudes.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(id, status) {
    setUpdatingId(id);
    try {
      const token = await getToken();
      const updated = await updateWithdrawalRequestStatus(token, id, status);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: updated.status, resolvedAt: updated.resolvedAt } : r)));
    } catch (err) {
      console.error("No se pudo actualizar el estado de la solicitud", err);
      toast.error(err.message || "No pudimos actualizar el estado.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Solicitudes de arrepentimiento</h1>
        <p className="text-sm text-slate-400">
          Pedidos de contacto/devolución registrados por compradores. Registrar una solicitud no confirma ningún
          reembolso — los reembolsos reales de Mercado Pago siguen su propio proceso.
        </p>
      </div>

      {error && <InlineErrorNotice message={error} onRetry={load} />}

      {loading ? (
        <p className="text-sm text-slate-400">Cargando solicitudes...</p>
      ) : requests.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">Todavía no hay solicitudes registradas.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0B1120]/90">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Evento</th>
                <th className="px-4 py-3 font-medium">Compra</th>
                <th className="px-4 py-3 font-medium">Solicitada</th>
                <th className="px-4 py-3 font-medium">Motivo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-slate-200">{r.event?.title ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatCurrencyARS(r.saleTotal)} · {r.ticketCount} {r.ticketCount === 1 ? "entrada" : "entradas"}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {r.reason ? REASON_LABEL[r.reason] ?? r.reason : "Sin especificar"}
                    {r.reasonNote && <p className="mt-0.5 max-w-[220px] truncate text-xs text-slate-500" title={r.reasonNote}>{r.reasonNote}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
                      value={r.status}
                      disabled={updatingId === r.id}
                      onChange={(e) => handleStatusChange(r.id, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
