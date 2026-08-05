import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { CalendarDays, MapPin, User, Mail, IdCard, ScanLine, History } from "lucide-react";
import Drawer from "../../../components/ui/Drawer.jsx";
import Button from "../../../components/ui/Button.jsx";
import ConfirmDialog from "../../../components/ui/ConfirmDialog.jsx";
import { useToast } from "../../../context/ToastContext.jsx";
import {
  cancelTicket,
  rehabilitateTicket,
  reactivateTicket,
  markTicketUsedManually,
  deleteTicket,
} from "../../../lib/ticketAdminApi.js";
import {
  ticketStatusLabel,
  ticketStatusBadgeTone,
  CHECKIN_SOURCE_LABEL,
  AUDIT_ACTION_LABEL,
  AUDIT_ACTOR_TYPE_LABEL,
  formatDateTime,
} from "../ticketAdminDisplay.js";

// Sólo se muestran los botones válidos para el estado actual — el backend
// también los valida (ticketAdmin.service.js), esto es sólo para no
// ofrecer una acción que va a fallar. "call" apunta al endpoint real; el
// "label" que ve el organizador no siempre coincide con el nombre interno
// del endpoint — ver la aclaración en ticketAdminApi.js.
function getActionsForTicket(ticket) {
  if (ticket.deletedAt) return [];
  if (ticket.status === "ACTIVE") {
    return [
      { key: "cancel", label: "Cancelar", danger: true, call: cancelTicket, confirmText: "¿Deseás cancelar esta entrada?" },
      { key: "mark-used", label: "Marcar utilizada manualmente", call: markTicketUsedManually, confirmText: "¿Deseás marcar esta entrada como utilizada manualmente?" },
      { key: "delete", label: "Eliminar", danger: true, call: deleteTicket, confirmText: "¿Deseás eliminar esta entrada?" },
    ];
  }
  if (ticket.status === "USED") {
    return [
      { key: "reactivate", label: "Rehabilitar", call: reactivateTicket, confirmText: "¿Deseás rehabilitar esta entrada?" },
      { key: "delete", label: "Eliminar", danger: true, call: deleteTicket, confirmText: "¿Deseás eliminar esta entrada?" },
    ];
  }
  if (ticket.status === "CANCELLED") {
    return [
      { key: "rehabilitate", label: "Reactivar", call: rehabilitateTicket, confirmText: "¿Deseás reactivar esta entrada?" },
      { key: "delete", label: "Eliminar", danger: true, call: deleteTicket, confirmText: "¿Deseás eliminar esta entrada?" },
    ];
  }
  // REFUNDED: sólo visualizar, sin acciones.
  return [];
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-slate-200">{value}</p>
      </div>
    </div>
  );
}

// Detalle de una entrada vendida — abierto desde OrganizerTickets.jsx.
// `ticket` viene con checkIns/auditLogs ya incluidos (mismo listado que
// alimenta la tabla, ver listTicketsOrganizerService): no hace ninguna
// carga propia. `onChanged` es el refetch de la lista del padre — como el
// padre deriva el ticket seleccionado de esa misma lista, este drawer se
// actualiza solo (estado, check-ins, auditoría) sin lógica extra acá.
export default function TicketDetailDrawer({ ticket, onClose, onChanged }) {
  const { getToken } = useAuth();
  const toast = useToast();
  const [actingKey, setActingKey] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const actions = getActionsForTicket(ticket);

  async function runAction(action) {
    setActingKey(action.key);
    try {
      const token = await getToken();
      await action.call(token, ticket.eventId, ticket.id);
      toast.success("Listo.");
      onChanged();
    } catch (err) {
      toast.error(err.message || "No pudimos completar la acción.");
    } finally {
      setActingKey(null);
      setConfirmAction(null);
    }
  }

  return (
    <Drawer title={`Entrada ${ticket.ticketNumber}`} onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeTone(ticket)}`}>
            {ticketStatusLabel(ticket)}
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <InfoRow icon={CalendarDays} label="Evento" value={ticket.eventTitle} />
          <InfoRow icon={CalendarDays} label="Función" value={formatDateTime(ticket.functionDate)} />
          <InfoRow icon={MapPin} label="Lugar" value={ticket.venue} />
          <InfoRow icon={User} label="Comprador" value={ticket.buyerName} />
          <InfoRow icon={Mail} label="Correo" value={ticket.buyerEmail} />
          <InfoRow icon={IdCard} label="DNI" value={ticket.buyerDocument} />
          <InfoRow icon={CalendarDays} label="Fecha de compra" value={formatDateTime(ticket.createdAt)} />
        </div>

        {actions.length > 0 && (
          <div className="flex flex-col gap-2">
            {actions.map((action) => (
              <Button
                key={action.key}
                variant="secondary"
                loading={actingKey === action.key}
                loadingText="Procesando..."
                disabled={actingKey !== null && actingKey !== action.key}
                className={`w-full justify-center ${action.danger ? "text-rose-400" : ""}`}
                onClick={() => setConfirmAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <ScanLine className="h-3.5 w-3.5" />
            Check-ins ({ticket.checkIns.length})
          </h4>
          {ticket.checkIns.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no ingresó.</p>
          ) : (
            <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
              {ticket.checkIns.map((checkIn) => (
                <div key={checkIn.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-200">{formatDateTime(checkIn.scannedAt)}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      {CHECKIN_SOURCE_LABEL[checkIn.source] ?? checkIn.source}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {checkIn.gate ? `${checkIn.gate} · ` : ""}
                    {checkIn.scannerName ?? "Sin scanner asociado"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <History className="h-3.5 w-3.5" />
            Auditoría ({ticket.auditLogs.length})
          </h4>
          {ticket.auditLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Sin acciones administrativas todavía.</p>
          ) : (
            <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
              {ticket.auditLogs.map((log) => (
                <div key={log.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{AUDIT_ACTION_LABEL[log.action] ?? log.action}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                  </div>
                  {(log.fromStatus || log.toStatus) && (
                    <p className="text-xs text-slate-500">
                      {log.fromStatus ?? "—"} → {log.toStatus ?? "—"}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    {AUDIT_ACTOR_TYPE_LABEL[log.actorType] ?? log.actorType}
                    {log.actorName ? `: ${log.actorName}` : ""}
                  </p>
                  {log.reason && <p className="text-xs italic text-slate-400">"{log.reason}"</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.label}
          description={confirmAction.confirmText}
          confirmLabel={confirmAction.label}
          danger={confirmAction.danger}
          loading={actingKey === confirmAction.key}
          onConfirm={() => runAction(confirmAction)}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </Drawer>
  );
}
