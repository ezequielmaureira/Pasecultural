import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { formatDateTime, formatCurrencyARS } from "../../lib/format.js";
import {
  getWithdrawalRequests,
  updateWithdrawalRequestStatus,
  getWithdrawalRequestTickets,
  returnWithdrawalRequestTickets,
} from "../../lib/withdrawalRequestApi.js";

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
  DISMISSED: "Descartada por el comprador",
  RESOLVED: "Entrada devuelta",
};

// RESOLVED deliberadamente FUERA de las opciones seleccionables del select
// de abajo — desde esta ronda sólo se alcanza mediante "Marcar entrada
// como devuelta" (que además cancela el/los Ticket real(es), ver el
// informe de entrega), nunca un clic administrativo sin acción real
// detrás. DISMISSED tampoco es seleccionable acá: es una decisión
// exclusiva del comprador (ver WithdrawalRequest.jsx, público). Este
// select queda como lo que siempre fue conceptualmente: alternar "en
// gestión" mientras la solicitud sigue activa.
const STATUS_OPTIONS = ["REQUESTED", "CONTACTED"];
const ACTIVE_STATUSES = new Set(["REQUESTED", "CONTACTED"]);

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

  // Cierre del ciclo — "Marcar entrada como devuelta". Dos pasos: elegir
  // cuál(es) entrada(s) de la Sale (puede tener varias, ver el informe de
  // entrega sección "compras multi-ticket") y confirmar explícitamente
  // antes de ejecutar — la acción cancela el/los Ticket real(es) y no
  // tiene deshacer desde acá.
  const [returnRequest, setReturnRequest] = useState(null);
  const [returnTickets, setReturnTickets] = useState([]);
  const [returnTicketsLoading, setReturnTicketsLoading] = useState(false);
  const [returnTicketsError, setReturnTicketsError] = useState("");
  const [selectedTicketIds, setSelectedTicketIds] = useState(() => new Set());
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [returning, setReturning] = useState(false);

  async function openReturnModal(request) {
    setReturnRequest(request);
    setReturnTickets([]);
    setSelectedTicketIds(new Set());
    setReturnTicketsError("");
    setReturnTicketsLoading(true);
    try {
      const token = await getToken();
      const result = await getWithdrawalRequestTickets(token, request.id);
      setReturnTickets(result.tickets);
    } catch (err) {
      setReturnTicketsError(err.message || "No pudimos cargar las entradas de esta compra.");
    } finally {
      setReturnTicketsLoading(false);
    }
  }

  function closeReturnModal() {
    setReturnRequest(null);
    setConfirmReturn(false);
  }

  function toggleTicketSelected(ticketId) {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  }

  async function handleConfirmReturn() {
    if (!returnRequest || selectedTicketIds.size === 0) return;
    setReturning(true);
    try {
      const token = await getToken();
      const result = await returnWithdrawalRequestTickets(token, returnRequest.id, [...selectedTicketIds]);
      setRequests((prev) => prev.map((r) => (r.id === returnRequest.id ? { ...r, status: result.status, resolvedAt: result.resolvedAt } : r)));
      toast.success(selectedTicketIds.size === 1 ? "Marcamos la entrada como devuelta." : "Marcamos las entradas como devueltas.");
      setConfirmReturn(false);
      setReturnRequest(null);
    } catch (err) {
      toast.error(err.message || "No pudimos marcar la entrada como devuelta.");
      setConfirmReturn(false);
    } finally {
      setReturning(false);
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
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const isActive = ACTIVE_STATUSES.has(r.status);
                return (
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
                      {isActive ? (
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
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs ${
                            r.status === "RESOLVED" ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-slate-400"
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isActive && (
                        <Button size="sm" variant="secondary" onClick={() => openReturnModal(r)}>
                          Marcar entrada como devuelta
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {returnRequest && !confirmReturn && (
        <Modal title="Marcar entrada como devuelta" onClose={closeReturnModal}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-400">
              Elegí cuál(es) entrada(s) de esta compra devolvió el comprador — {returnRequest.event?.title ?? "este evento"}.
            </p>

            {returnTicketsLoading ? (
              <p className="text-sm text-slate-400">Cargando entradas...</p>
            ) : returnTicketsError ? (
              <p className="text-sm text-rose-400">{returnTicketsError}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {returnTickets.map((t) => {
                  const disabled = t.status !== "ACTIVE";
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200 ${
                        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer has-[:checked]:border-violet-500/60 has-[:checked]:bg-violet-500/10"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-violet-500"
                        checked={selectedTicketIds.has(t.id)}
                        disabled={disabled}
                        onChange={() => toggleTicketSelected(t.id)}
                      />
                      {t.ticketTypeName} — {t.ticketNumber}
                      {disabled && <span className="ml-auto text-xs text-slate-500">{t.status === "USED" ? "Ya utilizada" : "Ya cancelada"}</span>}
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeReturnModal}>
                Cancelar
              </Button>
              <Button onClick={() => setConfirmReturn(true)} disabled={selectedTicketIds.size === 0}>
                Continuar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {returnRequest && confirmReturn && (
        <ConfirmDialog
          title="¿Marcar esta entrada como devuelta?"
          description={
            selectedTicketIds.size === 1
              ? "Esta entrada dejará de ser válida para el comprador y volverá a estar disponible para venta. Esta acción no realiza ningún reembolso de dinero."
              : `Estas ${selectedTicketIds.size} entradas dejarán de ser válidas para el comprador y volverán a estar disponibles para venta. Esta acción no realiza ningún reembolso de dinero.`
          }
          confirmLabel="Marcar como devuelta"
          danger
          loading={returning}
          onConfirm={handleConfirmReturn}
          onClose={() => setConfirmReturn(false)}
        />
      )}
    </div>
  );
}
