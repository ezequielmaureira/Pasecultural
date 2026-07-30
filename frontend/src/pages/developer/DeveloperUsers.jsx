import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, Eye, ShieldOff, RotateCcw, Trash2 } from "lucide-react";
import Avatar from "../../components/ui/Avatar.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import UserDetailModal from "../../components/developer/UserDetailModal.jsx";
import { apiFetch } from "../../lib/api.js";
import { useBackendUser } from "../../context/AuthContext.jsx";
import {
  USER_ROLE_LABEL,
  USER_ROLE_FILTERS,
  USER_STATUS_LABEL,
  USER_STATUS_STYLES,
} from "../../lib/userMeta.js";
import { useToast } from "../../context/ToastContext.jsx";

function Pill({ status }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        USER_STATUS_STYLES[status] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {USER_STATUS_LABEL[status] ?? status}
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

export default function DeveloperUsers() {
  const { getToken } = useAuth();
  const { backendUser } = useBackendUser();
  const toast = useToast();

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [updatingAction, setUpdatingAction] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      if (search.trim()) params.set("search", search.trim());
      const query = params.toString() ? `?${params.toString()}` : "";
      const { users: data } = await apiFetch(`/api/users${query}`, { token });
      setUsers(data ?? []);
    } catch (err) {
      console.error("No se pudieron cargar los usuarios", err);
      setError(err.message || "No pudimos cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }, [getToken, roleFilter, search]);

  useEffect(() => {
    const timeout = setTimeout(loadUsers, 250);
    return () => clearTimeout(timeout);
  }, [loadUsers]);

  async function changeRole(id, role) {
    setUpdatingId(id);
    setUpdatingAction("role");
    setError("");
    try {
      const token = await getToken();
      const { user } = await apiFetch(`/api/users/${id}/role`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ role }),
      });
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
      setSelected((prev) => (prev && prev.id === id ? user : prev));
      toast.success("Rol actualizado.");
    } catch (err) {
      console.error("No se pudo cambiar el rol", err);
      setError(err.message || "No se pudo cambiar el rol.");
    } finally {
      setUpdatingId(null);
      setUpdatingAction(null);
    }
  }

  async function changeStatus(id, status) {
    setUpdatingId(id);
    setUpdatingAction(status);
    setError("");
    try {
      const token = await getToken();
      const { user } = await apiFetch(`/api/users/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
      setSelected((prev) => (prev && prev.id === id ? user : prev));
      toast.success(status === "ACTIVE" ? "Usuario reactivado." : "Usuario suspendido.");
    } catch (err) {
      console.error("No se pudo cambiar el estado", err);
      setError(err.message || "No se pudo cambiar el estado.");
    } finally {
      setUpdatingId(null);
      setUpdatingAction(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setUpdatingId(pendingDelete.id);
    setUpdatingAction("delete");
    try {
      const token = await getToken();
      await apiFetch(`/api/users/${pendingDelete.id}`, {
        method: "DELETE",
        token,
      });
      setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
      setSelected((prev) => (prev && prev.id === pendingDelete.id ? null : prev));
      setPendingDelete(null);
      toast.success("Usuario eliminado.");
    } catch (err) {
      console.error("No se pudo eliminar el usuario", err);
      setError(err.message || "No se pudo eliminar el usuario.");
    } finally {
      setUpdatingId(null);
      setUpdatingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Usuarios</h1>
        <p className="text-sm text-slate-400">
          Administrá los usuarios registrados en la plataforma
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {USER_ROLE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRoleFilter(f.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                roleFilter === f.id
                  ? "bg-violet-500/10 text-violet-300"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
            placeholder="Buscar por nombre o email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Avatar</th>
                <th className="px-6 py-3 font-medium">Nombre</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Rol</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Registro</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4" colSpan={7}>
                      <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
                    </td>
                  </tr>
                ))}
              {!loading && users.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
                const isSelf = u.id === backendUser?.id;
                const busy = updatingId === u.id;
                return (
                  <tr key={u.id}>
                    <td className="px-6 py-4">
                      <Avatar
                        src={u.imageUrl}
                        name={name || u.email}
                        size="sm"
                        className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-white">{name || "—"}</p>
                      {isSelf && (
                        <p className="text-xs text-violet-400">Vos</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{u.email}</td>
                    <td className="px-6 py-4 text-slate-300">
                      {USER_ROLE_LABEL[u.role] ?? u.role}
                    </td>
                    <td className="px-6 py-4">
                      <Pill status={u.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {new Date(u.createdAt).toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Ver" onClick={() => setSelected(u)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        {u.status === "ACTIVE" ? (
                          <IconButton
                            title="Suspender"
                            disabled={busy || isSelf}
                            loading={busy && updatingAction === "SUSPENDED"}
                            onClick={() => changeStatus(u.id, "SUSPENDED")}
                          >
                            <ShieldOff className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            title="Reactivar"
                            disabled={busy}
                            loading={busy && updatingAction === "ACTIVE"}
                            onClick={() => changeStatus(u.id, "ACTIVE")}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </IconButton>
                        )}
                        <IconButton
                          title={
                            isSelf
                              ? "No podés eliminar tu propio usuario"
                              : "Eliminar"
                          }
                          disabled={busy || isSelf}
                          onClick={() => setPendingDelete(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No hay usuarios para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="px-6 py-4 text-sm text-rose-400">{error}</p>}
      </div>

      {selected && (
        <UserDetailModal
          user={selected}
          isSelf={selected.id === backendUser?.id}
          onClose={() => setSelected(null)}
          onChangeRole={changeRole}
          onChangeStatus={changeStatus}
          onDelete={(user) => setPendingDelete(user)}
          updating={updatingId === selected.id}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar usuario"
          description={`Esta acción no se puede deshacer. Se eliminará a ${
            [pendingDelete.firstName, pendingDelete.lastName]
              .filter(Boolean)
              .join(" ") || pendingDelete.email
          } de forma permanente.`}
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
