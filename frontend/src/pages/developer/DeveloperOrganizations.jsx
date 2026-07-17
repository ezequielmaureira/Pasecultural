import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, X as XIcon, Ban, Eye, Trash2 } from "lucide-react";
import Avatar from "../../components/ui/Avatar.jsx";
import OrganizationDetailModal from "../../components/developer/OrganizationDetailModal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { apiFetch } from "../../lib/api.js";
import {
  ORG_STATUS_LABEL,
  ORG_STATUS_STYLES,
  ORG_STATUS_FILTERS,
} from "../../lib/organizationStatus.js";

function Pill({ status }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        ORG_STATUS_STYLES[status] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {ORG_STATUS_LABEL[status] ?? status}
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

export default function DeveloperOrganizations() {
  const { getToken } = useAuth();
  const [filter, setFilter] = useState("ALL");
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const query = filter !== "ALL" ? `?status=${filter}` : "";
      const { organizations: data } = await apiFetch(
        `/api/organizations${query}`,
        { token }
      );
      setOrganizations(data ?? []);
    } catch (err) {
      console.error("No se pudieron cargar las organizaciones", err);
      setError(err.message || "No pudimos cargar las organizaciones.");
    } finally {
      setLoading(false);
    }
  }, [getToken, filter]);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  async function changeStatus(id, status) {
    setUpdatingId(id);
    try {
      const token = await getToken();
      const { organization } = await apiFetch(`/api/organizations/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
      setOrganizations((prev) =>
        prev.map((org) => (org.id === id ? organization : org))
      );
      setSelected((prev) => (prev && prev.id === id ? organization : prev));
    } catch (err) {
      console.error("No se pudo actualizar la organización", err);
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setUpdatingId(pendingDelete.id);
    try {
      const token = await getToken();
      await apiFetch(`/api/organizations/${pendingDelete.id}`, {
        method: "DELETE",
        token,
      });
      setOrganizations((prev) => prev.filter((org) => org.id !== pendingDelete.id));
      setSelected((prev) => (prev && prev.id === pendingDelete.id ? null : prev));
      setPendingDelete(null);
    } catch (err) {
      console.error("No se pudo eliminar la organización", err);
      setError(err.message || "No se pudo eliminar la organización.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Organizaciones</h1>
        <p className="text-sm text-slate-400">
          Revisá y aprobá las organizaciones antes de que puedan publicar eventos
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ORG_STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
              filter === f.id
                ? "bg-violet-500/10 text-violet-300"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Logo</th>
                <th className="px-6 py-3 font-medium">Nombre</th>
                <th className="px-6 py-3 font-medium">Responsable</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Registro</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {organizations.map((org) => {
                const responsibleName = [
                  org.responsibleFirstName,
                  org.responsibleLastName,
                ]
                  .filter(Boolean)
                  .join(" ");
                const ownerName = [org.owner?.firstName, org.owner?.lastName]
                  .filter(Boolean)
                  .join(" ");
                const busy = updatingId === org.id;
                return (
                  <tr key={org.id}>
                    <td className="px-6 py-4">
                      <Avatar
                        src={org.logo}
                        name={org.name}
                        size="sm"
                        className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-white">{org.name}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {responsibleName || ownerName || org.owner?.email || "—"}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{org.email}</td>
                    <td className="px-6 py-4">
                      <Pill status={org.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {new Date(org.createdAt).toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Ver" onClick={() => setSelected(org)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title={
                            org.status === "SUSPENDED" || org.status === "REJECTED"
                              ? "Reactivar"
                              : "Aprobar"
                          }
                          disabled={busy || org.status === "APPROVED"}
                          onClick={() => changeStatus(org.id, "APPROVED")}
                        >
                          <Check className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title="Rechazar"
                          disabled={busy || org.status === "REJECTED"}
                          onClick={() => changeStatus(org.id, "REJECTED")}
                        >
                          <XIcon className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title="Suspender"
                          disabled={busy || org.status === "SUSPENDED"}
                          onClick={() => changeStatus(org.id, "SUSPENDED")}
                        >
                          <Ban className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title="Eliminar"
                          disabled={busy}
                          onClick={() => setPendingDelete(org)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && organizations.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No hay organizaciones para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && (
          <p className="px-6 py-4 text-sm text-slate-500">Cargando organizaciones...</p>
        )}
        {error && <p className="px-6 py-4 text-sm text-rose-400">{error}</p>}
      </div>

      {selected && (
        <OrganizationDetailModal
          organization={selected}
          onClose={() => setSelected(null)}
          onChangeStatus={changeStatus}
          onDelete={(org) => setPendingDelete(org)}
          updating={updatingId === selected.id}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar organización"
          description={`Esta acción no se puede deshacer. Se eliminará "${pendingDelete.name}" de forma permanente.`}
          confirmLabel="Eliminar"
          danger
          loading={updatingId === pendingDelete.id}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
