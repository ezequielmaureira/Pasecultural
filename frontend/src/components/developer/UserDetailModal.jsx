import { useState } from "react";
import { Mail, Calendar, ShieldCheck } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import Avatar from "../ui/Avatar.jsx";
import { inputClass } from "../ui/FormField.jsx";
import {
  USER_ROLE_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_STYLES,
} from "../../lib/userMeta.js";

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm text-slate-200">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function UserDetailModal({
  user,
  isSelf,
  onClose,
  onChangeRole,
  onChangeStatus,
  onDelete,
  updating,
}) {
  const [role, setRole] = useState(user?.role ?? "CUSTOMER");

  if (!user) return null;

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
  const roleChanged = role !== user.role;

  return (
    <Modal title="Detalle del usuario" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar
            src={user.imageUrl}
            name={name}
            size="lg"
            className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-white">{name}</p>
            <p className="truncate text-sm text-slate-400">{user.email}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              USER_STATUS_STYLES[user.status] ?? "bg-white/10 text-slate-400"
            }`}
          >
            {USER_STATUS_LABEL[user.status] ?? user.status}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow
            icon={Calendar}
            label="Fecha de registro"
            value={new Date(user.createdAt).toLocaleDateString("es-AR")}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            Rol del usuario
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isSelf}
            >
              {Object.entries(USER_ROLE_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={!roleChanged || updating || isSelf}
              onClick={() => onChangeRole(user.id, role)}
            >
              Guardar rol
            </Button>
          </div>
          {isSelf && (
            <p className="mt-2 text-xs text-slate-500">
              No podés cambiar tu propio rol.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={updating}>
            Cancelar
          </Button>
          {user.status === "ACTIVE" ? (
            <Button
              variant="secondary"
              onClick={() => onChangeStatus(user.id, "SUSPENDED")}
              disabled={updating || isSelf}
            >
              Suspender
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => onChangeStatus(user.id, "ACTIVE")}
              disabled={updating}
            >
              Reactivar
            </Button>
          )}
          <Button
            className="bg-rose-600 text-white hover:bg-rose-500"
            onClick={() => onDelete(user)}
            disabled={updating || isSelf}
          >
            Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
