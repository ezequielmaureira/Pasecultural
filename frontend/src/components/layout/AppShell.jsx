import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

// El sidebar es fijo (280px) sólo a partir de `lg`; en pantallas más chicas
// se vuelve un panel off-canvas que se abre/cierra con este estado, en vez
// de ocupar la mitad del ancho disponible de un celular.
export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#05070B]">
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
