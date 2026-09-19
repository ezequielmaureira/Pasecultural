import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
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
  Undo2,
  Sparkles,
  Image,
  Zap,
} from "lucide-react";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { NEW_EVENT_REQUEST_EVENT } from "../../lib/eventChatEvents.js";
import { apiFetch } from "../../lib/api.js";

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
    // Developer > Planes — antes vivía como "Límites por plan" dentro de
    // Configuración; ahora es su propia sección (ver
    // pages/developer/DeveloperPlans.jsx).
    { label: "Planes", icon: Sparkles, path: "/developer/planes", end: true },
    // MP-6 — antes un placeholder deshabilitado (sin `path`, ver
    // DisabledNavItem más abajo); activado con la primera sección real:
    // comisión de servicio (ver pages/developer/DeveloperSettings.jsx).
    { label: "Configuración", icon: Settings, path: "/developer/configuracion", end: true },
    // Developer > Contenido (V1 mínima) — hoy administra sólo la imagen
    // que reemplaza la introducción de Organizer > Fest Pass. Ver
    // pages/developer/DeveloperContent.jsx.
    { label: "Contenido", icon: Image, path: "/developer/contenido", end: true },
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
        // Fest Pass — creador rápido alternativo (mismo Event real, ver
        // pages/organizer/FestPass.jsx), no un permiso ni un rol distinto.
        { label: "Fest Pass", path: "/organizador/fest-pass", end: true },
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
    { label: "Solicitudes", icon: Undo2, path: "/organizador/solicitudes", end: true },
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
            : "text-slate-400 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5 light:hover:text-slate-900"
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
              isActive ? "text-violet-400" : "text-slate-500 group-hover:text-white light:group-hover:text-slate-900"
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
  const { getToken } = useAuth();
  const location = useLocation();
  const role = backendUser?.role?.toLowerCase();
  const navItems = NAV_BY_ROLE[role] ?? [];

  // Onboarding de "Crear evento" (mismo criterio que Organizer > Eventos >
  // Lista, ver OrganizerEvents.jsx) — pero Sidebar vive FUERA de
  // OrganizerDataProvider (montado en AppShell.jsx, no dentro del Outlet de
  // /organizador), así que NUNCA puede usar useOrganizerData() acá. Fetch
  // propio y liviano, sólo para Organizer, sólo para saber si la lista está
  // vacía (mismo endpoint/misma regla que Lista: GET /api/events/mine
  // devuelve [] -> onboarding; nunca se consultan archivados para esta
  // señal puntual del Sidebar). null = todavía no se sabe (nunca pulsa
  // mientras tanto, evita el flash al abrir el panel); true/false = ya
  // resuelto.
  const [organizerHasEvents, setOrganizerHasEvents] = useState(null);

  useEffect(() => {
    if (role !== "organizer") return undefined;
    let cancelled = false;
    async function checkHasEvents() {
      try {
        const token = await getToken();
        const { events } = await apiFetch("/api/events/mine", { token });
        if (!cancelled) setOrganizerHasEvents(events.length > 0);
      } catch (err) {
        // Conservador: se queda en null (nunca se asume "primera
        // creación" ante un error) — sin toast, es un fetch auxiliar.
        console.error("No se pudo determinar si el Organizer ya tiene eventos", err);
      }
    }
    checkHasEvents();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const isFirstEvent = role === "organizer" && organizerHasEvents === false;

  // "Crear evento" ya está resuelto por react-router cuando cambia de
  // pantalla (ver el efecto `startFresh` en ConversationView.jsx). Pero si
  // el click pasa por el mismo pathname en el que ya se está parado
  // (volver a tocar "Crear evento" desde dentro del wizard conversacional),
  // el Link no navega ni remonta nada — así que ese caso puntual se resuelve
  // avisándole directamente a ConversationView vía este evento en vez de
  // depender de la navegación. `tutorial` viaja en `detail` para que
  // OrganizerEventChat.jsx (un listener SEPARADO, sólo visual — ver ese
  // archivo) pueda sincronizar el toggle sin que este Sidebar necesite
  // saber nada de tutorialEnabled/sessionStorage.
  function handleNavClick(event, item, tutorial) {
    if (item.path === "/organizador/eventos/nuevo" && location.pathname === item.path) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(NEW_EVENT_REQUEST_EVENT, { detail: { tutorial } }));
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
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-[#0B1120] shadow-xl shadow-black/30 light:bg-white light:shadow-slate-300/60">
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
            <p className="truncate text-base font-bold leading-tight text-white light:text-slate-900">
              Smarticket
            </p>
            <p className="truncate text-xs text-slate-400 light:text-slate-500">
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
                    {item.children.map((child) => {
                      // Fest Pass — único hijo destacado del menú: mismo
                      // <NavLink> y misma lista que el resto de los children,
                      // pero con tratamiento "premium/neon" (botón propio,
                      // no un submenu común): gradiente azul→violeta→fucsia,
                      // borde luminoso, doble glow exterior, ícono Zap con
                      // drop-shadow, y una capa de brillo diagonal interna
                      // (span absoluto, pointer-events-none, no interfiere
                      // con el click) para sensación glass/neon. Mantiene su
                      // identidad TANTO activo como inactivo — sólo cambia
                      // de intensidad entre los dos estados. El resto de los
                      // children conserva exactamente el mismo comportamiento
                      // de siempre (texto violeta liso cuando está activo,
                      // gris cuando no).
                      const isFestPass = child.path === "/organizador/fest-pass";
                      if (isFestPass) {
                        return (
                          <NavLink
                            key={child.label}
                            to={child.path}
                            end={child.end}
                            state={child.state}
                            onClick={(event) => handleNavClick(event, child)}
                            className={({ isActive }) =>
                              `group relative -mx-1 flex items-center gap-2 overflow-hidden rounded-xl border px-4 py-2.5 text-sm transition-all duration-300 ease-out ${
                                isActive
                                  ? "border-white/30 bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-500 font-semibold text-white shadow-[0_0_14px_rgba(99,102,241,0.65),0_0_28px_rgba(168,85,247,0.45),0_0_38px_rgba(236,72,153,0.20)]"
                                  : "border-violet-500/40 bg-gradient-to-r from-blue-950/60 via-violet-900/50 to-fuchsia-900/40 font-medium text-violet-100 shadow-[0_0_10px_rgba(99,102,241,0.2)] hover:border-violet-400/60 hover:from-blue-600/40 hover:via-violet-600/40 hover:to-fuchsia-500/30 hover:text-white hover:shadow-[0_0_16px_rgba(99,102,241,0.4),0_0_26px_rgba(168,85,247,0.3)]"
                              }`
                            }
                          >
                            {({ isActive }) => (
                              <>
                                {/* Capa de brillo diagonal — puramente visual,
                                    no capta clicks (pointer-events-none). */}
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-white/0 to-transparent opacity-60"
                                />
                                <Zap
                                  className={`relative h-4 w-4 shrink-0 transition-colors duration-300 ${
                                    isActive
                                      ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                                      : "text-violet-300 group-hover:text-white"
                                  }`}
                                />
                                <span className="relative">{child.label}</span>
                              </>
                            )}
                          </NavLink>
                        );
                      }
                      // "Crear evento" — mismo onboarding que Organizer >
                      // Eventos > Lista (ver OrganizerEvents.jsx): mientras
                      // sea la primera creación real, este item también
                      // pulsa (reutiliza .smarticket-cta-pulse, ya resuelve
                      // prefers-reduced-motion) y manda tutorial:true. Con
                      // eventos ya creados, vuelve EXACTAMENTE al estilo
                      // plano de siempre — mismo className que el resto de
                      // los children, sin ninguna rama nueva.
                      const isCreateEvent = child.path === "/organizador/eventos/nuevo";
                      const createEventState = isCreateEvent
                        ? { fresh: true, tutorial: isFirstEvent }
                        : child.state;

                      return (
                        <NavLink
                          key={child.label}
                          to={child.path}
                          end={child.end}
                          state={createEventState}
                          onClick={(event) => handleNavClick(event, child, isCreateEvent ? isFirstEvent : undefined)}
                          className={({ isActive }) =>
                            isCreateEvent && isFirstEvent
                              ? "smarticket-cta-pulse rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-100 transition-colors duration-150 hover:bg-violet-500/15 hover:text-white"
                              : `rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${
                                  isActive
                                    ? "text-violet-300"
                                    : "text-slate-500 hover:text-white light:hover:text-slate-900"
                                }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      );
                    })}
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
