import { Link, NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  Ticket,
  Users,
  Briefcase,
  ScanLine,
  LineChart,
  Settings,
  ChevronsLeft,
  Database,
  CalendarRange,
  History,
  Receipt,
  Gift,
} from "lucide-react";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { NEW_EVENT_REQUEST_EVENT } from "../../lib/eventChatEvents.js";

const NAV_BY_ROLE = {
  developer: [
    { label: "Dashboard", icon: LayoutDashboard, path: "/developer", end: true },
    { label: "Eventos", icon: CalendarDays, path: "/developer/eventos", end: true },
    { label: "Entradas", icon: Ticket, path: "/developer/entradas", end: true },
    {
      label: "Usuarios",
      icon: Users,
      path: "/developer/usuarios",
      end: true,
    },
    {
      label: "Organizaciones",
      icon: Briefcase,
      path: "/developer/organizaciones",
      end: true,
    },
    { label: "Scanners", icon: ScanLine, path: "/developer/scanners", end: true },
    { label: "Ventas", icon: LineChart, path: "/developer/ventas", end: true },
    // MP-6 — antes un placeholder deshabilitado (sin `path`, ver
    // DisabledNavItem más abajo); activado con la primera sección real:
    // comisión de servicio (ver pages/developer/DeveloperSettings.jsx).
    { label: "Configuración", icon: Settings, path: "/developer/configuracion", end: true },
    {
      label: "Base de Datos",
      icon: Database,
      path: "/developer/base-de-datos",
      end: true,
    },
  ],
  organizer: [
    { label: "Dashboard", icon: LayoutDashboard, path: "/organizador", end: true },
    {
      label: "Eventos",
      icon: CalendarDays,
      path: "/organizador/eventos",
      end: false,
      children: [
        { label: "Lista", path: "/organizador/eventos", end: true },
        {
          label: "Crear evento",
          path: "/organizador/eventos/nuevo",
          end: true,
          state: { fresh: true },
        },
      ],
    },
    { label: "Entradas", icon: Ticket, path: "/organizador/entradas", end: true },
    {
      label: "Cortesías",
      icon: Gift,
      path: "/organizador/cortesias",
      end: true,
      children: [
        { label: "Emitir cortesía", path: "/organizador/cortesias/emitir", end: true },
        { label: "Historial", path: "/organizador/cortesias/historial", end: true },
      ],
    },
    { label: "Ventas", icon: Receipt, path: "/organizador/ventas", end: true },
    {
      label: "Scanners",
      icon: ScanLine,
      path: "/organizador/scanners",
      end: false,
      children: [
        { label: "Lista", path: "/organizador/scanners", end: true },
        { label: "Agregar scanner", path: "/organizador/scanners/nuevo", end: true },
      ],
    },
    { label: "Estado de Funciones", icon: CalendarRange, path: "/organizador/funciones", end: true },
    { label: "Historial de Eventos", icon: History, path: "/organizador/historial", end: true },
    {
      label: "Configuración",
      icon: Settings,
      path: "/organizador/configuracion",
      end: true,
    },
  ],
  // El Scanner ya no usa AppShell/Sidebar — tiene su propio shell (ver
  // pages/scanner/ScannerShell.jsx) y el acceso no depende del rol de la
  // cuenta, sino de EventScanner.
};

function DisabledNavItem({ label, icon: Icon }) {
  return (
    <button
      type="button"
      disabled
      className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-600 opacity-60"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-slate-600" />
      {label}
    </button>
  );
}

function TopNavItem({ label, icon: Icon, path, end }) {
  if (!path) {
    return <DisabledNavItem label={label} icon={Icon} />;
  }
  return (
    <NavLink
      to={path}
      end={end}
      className={({ isActive }) =>
        `group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "bg-violet-500/10 text-violet-300"
            : "text-slate-400 hover:bg-white/5 hover:text-white"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-violet-500" />
          )}
          <Icon
            className={`h-[18px] w-[18px] shrink-0 transition-colors duration-150 ${
              isActive ? "text-violet-400" : "text-slate-500 group-hover:text-white"
            }`}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar({ open = false, onClose }) {
  const { backendUser } = useBackendUser();
  const location = useLocation();
  const role = backendUser?.role?.toLowerCase();
  const navItems = NAV_BY_ROLE[role] ?? [];

  // "Crear evento" ya está resuelto por react-router cuando cambia de
  // pantalla (ver el efecto `startFresh` en ConversationView.jsx). Pero si
  // el click pasa por el mismo pathname en el que ya se está parado
  // (volver a tocar "Crear evento" desde dentro del wizard conversacional),
  // el Link no navega ni remonta nada — así que ese caso puntual se resuelve
  // avisándole directamente a ConversationView vía este evento en vez de
  // depender de la navegación.
  function handleNavClick(event, item) {
    if (item.path === "/organizador/eventos/nuevo" && location.pathname === item.path) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(NEW_EVENT_REQUEST_EVENT));
    }
  }

  return (
    <>
      {/* Fondo que cierra el panel al tocar afuera; sólo existe en mobile,
          donde el sidebar es off-canvas en vez de fijo. */}
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[var(--sidebar-width)] max-w-[85vw] p-3 transition-transform duration-200 lg:z-20 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-[#0B1120] shadow-xl shadow-black/30">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition-colors duration-150 hover:bg-white/10 lg:hidden"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>

        <Link to="/" className="flex items-center gap-3 px-5 pb-6 pt-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-lg font-extrabold text-white">
            P
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-white">
              PaseCultural
            </p>
            <p className="truncate text-xs text-slate-400">
              Plataforma de gestión
            </p>
          </div>
        </Link>

        <nav className="flex-1 space-y-2 overflow-y-auto px-4">
          {/* onClick acá, no en cada link: cualquier navegación cierra el
              panel off-canvas en mobile sin pasar onClose a cada NavLink. */}
          <div onClick={onClose}>
            {navItems.map((item) => (
              <div key={item.label}>
                <TopNavItem {...item} />
                {item.children && (
                  <div className="ml-6 mt-1 flex flex-col gap-1 border-l border-white/10 pl-4">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.label}
                        to={child.path}
                        end={child.end}
                        state={child.state}
                        onClick={(event) => handleNavClick(event, child)}
                        className={({ isActive }) =>
                          `rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${
                            isActive
                              ? "text-violet-300"
                              : "text-slate-500 hover:text-white"
                          }`
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>
        </div>
      </aside>
    </>
  );
}
