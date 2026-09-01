import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import { OrganizationThemeProvider, useOrganizationTheme } from "../../context/OrganizationThemeContext.jsx";
import { ORG_THEME_CLASS } from "../../lib/organizationTheme.js";

// El sidebar es fijo (280px) sólo a partir de `lg`; en pantallas más chicas
// se vuelve un panel off-canvas que se abre/cierra con este estado, en vez
// de ocupar la mitad del ancho disponible de un celular.
//
// Organization Theme (dashboard) — Premium Fase 2D.1/2D.1.2. El Provider se
// monta siempre (ver el `export default` más abajo) — para Developer (o
// cualquier cuenta sin Organization propia), `organization` simplemente
// queda `null` tras el fetch y `brandingEnabled` es `false`, mismo
// resultado visual que antes.
function AppShellContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { brandingEnabled, confirmed } = useOrganizationTheme();

  // Cold start: el server todavía no confirmó si esta Organization es
  // Premium (Light Theme fijo) o FREE (dark estándar) — sin cache visual
  // de por medio (se eliminó junto con la personalización de colores), no
  // hay nada que pintar como definitivo todavía. Sidebar recibe
  // `coldStart` y muestra un shell neutro mínimo mientras tanto (ver
  // Sidebar.jsx). Apenas `confirmed` pasa a true, este estado desaparece.
  const coldStart = !confirmed;

  return (
    <div className={`min-h-screen bg-[#05070B] ${brandingEnabled ? ORG_THEME_CLASS : ""}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} coldStart={coldStart} />
      <Topbar onOpenSidebar={() => setSidebarOpen(true)} />
      <main className="pt-[var(--topbar-height)] lg:pl-[var(--sidebar-width)]">
        <div className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// Premium Fase 2D.1.2 — corrección de bug visual: ANTES el Provider sólo se
// montaba para role === "organizer", y `backendUser` (de dónde sale ese
// role) depende de que resuelva POST /api/auth/sync — un fetch enteramente
// ajeno al branding. Eso significaba que el bootstrap visual (que sólo
// necesita el `userId` de Clerk, resuelto localmente sin red) quedaba
// bloqueado detrás de ESE fetch extra, y el usuario veía un frame
// negro/neutro hasta que /auth/sync Y /organizations/me terminaran, en vez
// de branding inmediato desde el cache. Se monta el Provider SIEMPRE
// (mismo componente para Developer/Organizer) para que su bootstrap por
// `userId` (Clerk) arranque en cuanto sea posible, sin esperar a
// `backendUser`/rol — el Provider sigue sin usar el cache ni el rol para
// autorizar nada: `isFeatureAvailable` sigue siendo exclusivamente
// server-side, y GET /api/organizations/me (que ya devuelve `organization:
// null` para cualquier cuenta que no sea owner de una Organization) es el
// único cambio de comportamiento real para Developer — un fetch adicional
// inofensivo, no una fuga de datos ni de autorización.
export default function AppShell() {
  return (
    <OrganizationThemeProvider>
      <AppShellContent />
    </OrganizationThemeProvider>
  );
}
