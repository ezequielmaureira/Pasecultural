import { Link } from "react-router-dom";
import { useAuth, useClerk } from "@clerk/clerk-react";
import { Bell, User, Ticket, LayoutDashboard, LogOut } from "lucide-react";
import Button from "../ui/Button.jsx";
import Avatar from "../ui/Avatar.jsx";
import NavbarDropdown from "./NavbarDropdown.jsx";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { ROLE_HOME } from "../../lib/roles.js";

// Menú de usuario del Navbar público. No confundir con
// components/layout/UserMenu.jsx, que es el menú del Topbar interno del
// panel (Organizador/Developer) y no se toca en este rediseño.
export default function UserMenu() {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { backendUser } = useBackendUser();

  if (!isSignedIn) {
    return (
      <Link to="/iniciar-sesion">
        <Button size="sm">Ingresar</Button>
      </Link>
    );
  }

  const role = backendUser?.role?.toLowerCase();
  const panelHome = ROLE_HOME[role];
  const fullName = [backendUser?.firstName, backendUser?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const items = [
    { label: "Perfil", to: "/perfil", icon: User },
    { label: "Mis entradas", to: "/mis-entradas", icon: Ticket },
    ...(panelHome ? [{ label: "Panel", to: panelHome, icon: LayoutDashboard }] : []),
    {
      label: "Cerrar sesión",
      icon: LogOut,
      danger: true,
      onClick: () => signOut({ redirectUrl: "/" }),
    },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled
        aria-label="Notificaciones (próximamente)"
        title="Notificaciones (próximamente)"
        className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg text-slate-500"
      >
        <Bell className="h-[18px] w-[18px]" />
      </button>

      <NavbarDropdown
        align="right"
        items={items}
        trigger={
          <span className="relative block shrink-0 rounded-full ring-0 ring-violet-500/40 transition-shadow duration-150 hover:ring-4">
            <Avatar
              name={fullName || undefined}
              size="sm"
              className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
            />
          </span>
        }
      />
    </div>
  );
}
