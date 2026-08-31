import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { OrganizationThemeProvider, useOrganizationTheme } from "../../context/OrganizationThemeContext.jsx";
import { ORG_THEME_CLASS } from "../../lib/organizationTheme.js";

// El sidebar es fijo (280px) sólo a partir de `lg`; en pantallas más chicas
// se vuelve un panel off-canvas que se abre/cierra con este estado, en vez
// de ocupar la mitad del ancho disponible de un celular.
//
// Organization Theme (dashboard) — Premium Fase 2D.1. `useOrganizationTheme`
// devuelve el default seguro (brandingEnabled: false) cuando no hay
// OrganizationThemeProvider como ancestro — por eso este mismo componente
// sirve para Developer sin necesidad de una segunda copia del layout: sin
// Provider, el wrapper de abajo nunca gana la clase/estilo org-theme.
function AppShellContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { brandingEnabled, themeStyle } = useOrganizationTheme();

  return (
    <div
      style={brandingEnabled ? themeStyle : undefined}
      className={`min-h-screen bg-[#05070B] ${brandingEnabled ? ORG_THEME_CLASS : ""}`}
    >
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Topbar onOpenSidebar={() => setSidebarOpen(true)} />
      <main className="pt-[var(--topbar-height)] lg:pl-[var(--sidebar-width)]">
        <div className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// El Provider SOLO se monta para role === "organizer" — Developer nunca
// dispara el fetch de /organizations/me ni queda expuesto a ningún --org-*
// token (mismo AppShell, cero diferencia visual/funcional para Developer).
export default function AppShell() {
  const { backendUser } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";

  if (!isOrganizer) {
    return <AppShellContent />;
  }

  return (
    <OrganizationThemeProvider>
      <AppShellContent />
    </OrganizationThemeProvider>
  );
}
