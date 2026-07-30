import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Pencil, Rocket, Archive, Ban, Trash2, Plus, ShieldAlert } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { apiFetch } from "../../lib/api.js";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import { EVENT_STATUS_LABEL, EVENT_STATUS_STYLES } from "../../lib/eventStatus.js";
import { canPublishEvents } from "../../lib/organizationTrust.js";
import { useToast } from "../../context/ToastContext.jsx";

function Pill({ status }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        EVENT_STATUS_STYLES[status] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {EVENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function IconButton({ title, onClick, disabled, loading, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
    >
      {loading ? <Spinner size="xs" toneClassName="border-slate-500/40 border-t-slate-200" /> : children}
    </button>
  );
}

function formatDate(iso) {
  if (!iso) return "Sin fecha";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrganizerEvents() {
  const { getToken } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [updatingAction, setUpdatingAction] = useState(null);
  const [eventToDelete, setEventToDelete] = useState(null);
  const [actionError, setActionError] = useState("");

  async function loadEvents() {
    try {
      const token = await getToken();
      const [{ events: list }, { organization: org }] = await Promise.all([
        apiFetch("/api/events/mine", { token }),
        apiFetch("/api/organizations/me", { token }),
      ]);
      setEvents(list);
      setOrganization(org);
    } catch (err) {
      console.error("No se pudieron cargar los eventos", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPublish = canPublishEvents(organization);

  async function patchEvent(id, patch, action) {
    setUpdatingId(id);
    setUpdatingAction(action);
    setActionError("");
    try {
      const token = await getToken();
      const { event } = await apiFetch(`/api/events/${id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setEvents((prev) => prev.map((e) => (e.id === id ? event : e)));
      if (event.status === "PUBLISHED") toast.success("Evento publicado correctamente.");
      else if (event.status === "DRAFT") toast.success("Evento pasado a borrador.");
      else if (event.status === "CANCELLED") toast.success("Evento cancelado.");
    } catch (err) {
      console.error("No se pudo actualizar el evento", err);
      setActionError(err.message || "No se pudo actualizar el evento.");
    } finally {
      setUpdatingId(null);
      setUpdatingAction(null);
    }
  }

  function togglePublish(event) {
    const next = event.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    patchEvent(event.id, { status: next }, "publish");
  }

  function cancelEvent(event) {
    patchEvent(event.id, { status: "CANCELLED" }, "cancel");
  }

  async function confirmDelete() {
    if (!eventToDelete) return;
    const id = eventToDelete.id;
    setUpdatingId(id);
    setUpdatingAction("delete");
    try {
      const token = await getToken();
      await apiFetch(`/api/events/${id}`, { token, method: "DELETE" });
      setEvents((prev) => prev.filter((e) => e.id !== id));
      toast.success("Evento eliminado.");
    } catch (err) {
      console.error("No se pudo eliminar el evento", err);
      setActionError(err.message || "No se pudo eliminar el evento.");
    } finally {
      setUpdatingId(null);
      setUpdatingAction(null);
      setEventToDelete(null);
    }
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

      {!canPublish && !loading && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              Todavía no podés publicar eventos
            </p>
            <p className="mt-1 text-xs opacity-90">
              Tu organización está{" "}
              {organization?.status === "PENDING"
                ? "siendo revisada"
                : "sin aprobar"}
              . Podés crear y editar eventos como borrador; vas a poder
              publicarlos apenas un Developer apruebe tu organización.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-rose-400">{actionError}</p>
      )}

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Categoría</th>
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4" colSpan={5}>
                      <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
                    </td>
                  </tr>
                ))}
              {!loading && events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                    Todavía no creaste ningún evento.
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="px-6 py-4">
                    <p className="font-medium text-white">{event.title}</p>
                    <p className="text-xs text-slate-500">
                      {event.venue || "Lugar a confirmar"}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {event.category ? getEventCategoryLabel(event) : "—"}
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {formatDate(event.startDate)}
                  </td>
                  <td className="px-6 py-4">
                    <Pill status={event.status} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <Link to={`/organizador/eventos/${event.id}/editar`}>
                        <IconButton title="Editar">
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant={event.status === "PUBLISHED" ? "secondary" : "primary"}
                        onClick={() => togglePublish(event)}
                        title={
                          event.status !== "PUBLISHED" && !canPublish
                            ? "Tu organización todavía no fue aprobada"
                            : undefined
                        }
                        loading={updatingId === event.id && updatingAction === "publish"}
                        loadingText={event.status === "PUBLISHED" ? "Archivando..." : "Publicando..."}
                        disabled={
                          updatingId === event.id ||
                          event.status === "CANCELLED" ||
                          (event.status !== "PUBLISHED" && !canPublish)
                        }
                        className={
                          event.status === "PUBLISHED"
                            ? undefined
                            : "bg-emerald-600 text-white hover:bg-emerald-500"
                        }
                      >
                        {event.status === "PUBLISHED" ? (
                          <>
                            <Archive className="h-4 w-4" />
                            Pasar a borrador
                          </>
                        ) : (
                          <>
                            <Rocket className="h-4 w-4" />
                            Publicar
                          </>
                        )}
                      </Button>
                      <IconButton
                        title="Cancelar evento"
                        onClick={() => cancelEvent(event)}
                        loading={updatingId === event.id && updatingAction === "cancel"}
                        disabled={updatingId === event.id || event.status === "CANCELLED"}
                      >
                        <Ban className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        title="Eliminar"
                        onClick={() => setEventToDelete(event)}
                        disabled={updatingId === event.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {eventToDelete && (
        <ConfirmDialog
          title="Eliminar evento"
          description={`¿Seguro que querés eliminar "${eventToDelete.title}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          loading={updatingId === eventToDelete.id}
          onConfirm={confirmDelete}
          onClose={() => setEventToDelete(null)}
        />
      )}
    </div>
  );
}
