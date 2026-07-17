import { useRef, useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { MoreVertical, LogOut } from "lucide-react";
import Avatar from "../ui/Avatar.jsx";
import { ROLES } from "../../lib/roles.js";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { useClickOutside } from "../../lib/useClickOutside.js";

export default function UserMenu() {
  const { backendUser } = useBackendUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useClickOutside(menuRef, () => setOpen(false));

  const role = backendUser?.role?.toLowerCase();
  const roleLabel = ROLES.find((r) => r.id === role)?.label ?? "";
  const fullName = [backendUser?.firstName, backendUser?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    <div ref={menuRef} className="relative flex items-center gap-3">
      <div className="relative shrink-0">
        <Avatar
          name={fullName || undefined}
          size="sm"
          className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
        />
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0B1120] bg-emerald-400" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {fullName || "Usuario"}
        </p>
        <p className="truncate text-xs text-slate-400">{roleLabel}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 text-slate-500 transition-colors duration-150 hover:text-slate-300"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] shadow-xl shadow-black/40">
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: "/" })}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
