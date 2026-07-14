import { Link } from "react-router-dom";
import {
  Pencil,
  Eye,
  EyeOff,
  Copy,
  Ban,
  Trash2,
  Plus,
} from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { EVENT_STATUS } from "../../data/organizerMockData.js";

const STATUS_STYLES = {
  [EVENT_STATUS.PUBLISHED]: "bg-emerald-500/10 text-emerald-400",
  [EVENT_STATUS.DRAFT]: "bg-white/10 text-slate-400",
  [EVENT_STATUS.HIDDEN]: "bg-amber-500/10 text-amber-400",
  [EVENT_STATUS.CANCELLED]: "bg-rose-500/10 text-rose-400",
  [EVENT_STATUS.FINISHED]: "bg-sky-500/10 text-sky-400",
};

function Pill({ children }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        STATUS_STYLES[children] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {children}
    </span>
  );
}

function IconButton({ title, onClick, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
    >
      {children}
    </button>
  );
}

export default function OrganizerEvents() {
  const { events, updateEvent, duplicateEvent, removeEvent } =
    useOrganizerData();

  function togglePublish(event) {
    const next =
      event.status === EVENT_STATUS.PUBLISHED
        ? EVENT_STATUS.HIDDEN
        : EVENT_STATUS.PUBLISHED;
    updateEvent(event.id, { status: next });
  }

  function cancelEvent(event) {
    updateEvent(event.id, { status: EVENT_STATUS.CANCELLED });
  }

  function deleteEvent(event) {
    const hasSales = event.ticketTypes.some((tt) => (tt.sold ?? 0) > 0);
    if (hasSales) return;
    removeEvent(event.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Eventos</h1>
          <p className="text-sm text-slate-400">
            Creá y administrá tus eventos
          </p>
        </div>
        <Link to="/organizador/eventos/nuevo">
          <Button>
            <Plus className="h-4 w-4" />
            Crear evento
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Categoría</th>
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium">Entradas</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {events.map((event) => {
                const sold = event.ticketTypes.reduce(
                  (sum, tt) => sum + (tt.sold ?? 0),
                  0
                );
                const capacity = event.capacity || 0;
                const hasSales = sold > 0;
                return (
                  <tr key={event.id}>
                    <td className="px-6 py-4">
                      <p className="font-medium text-white">{event.name}</p>
                      <p className="text-xs text-slate-500">{event.venue}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {event.category}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {event.date} · {event.time}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {sold}/{capacity}
                    </td>
                    <td className="px-6 py-4">
                      <Pill>{event.status}</Pill>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/organizador/eventos/${event.id}/editar`}>
                          <IconButton title="Editar">
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                        </Link>
                        <IconButton
                          title={
                            event.status === EVENT_STATUS.PUBLISHED
                              ? "Ocultar"
                              : "Publicar"
                          }
                          onClick={() => togglePublish(event)}
                        >
                          {event.status === EVENT_STATUS.PUBLISHED ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </IconButton>
                        <IconButton
                          title="Duplicar"
                          onClick={() => duplicateEvent(event.id)}
                        >
                          <Copy className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title="Cancelar evento"
                          onClick={() => cancelEvent(event)}
                          disabled={event.status === EVENT_STATUS.CANCELLED}
                        >
                          <Ban className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title={
                            hasSales
                              ? "No se puede eliminar: tiene ventas"
                              : "Eliminar"
                          }
                          onClick={() => deleteEvent(event)}
                          disabled={hasSales}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
