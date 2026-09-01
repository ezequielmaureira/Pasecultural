import { Outlet } from "react-router-dom";
import Navbar from "../navbar/Navbar.jsx";
import Footer from "./Footer.jsx";
import { usePublicBranding } from "../../context/PublicBrandingContext.jsx";
import { ORG_THEME_CLASS } from "../../lib/organizationTheme.js";

// La autoridad de branding público sigue siendo exclusivamente
// `usePublicBranding()` (ya la consume Navbar) — nunca logo/slug/color.
// Aplicando la misma clase acá, en el wrapper que envuelve Navbar + Outlet
// + Footer, el Light Theme cubre TODO el viewport público de una
// Organization Premium de una sola vez — Footer no necesita ningún cambio
// propio porque sus clases (border-white/5, text-white, text-slate-400/500)
// ya están cubiertas por el remapeo scoped existente.
//
// El shell se muestra SIEMPRE de inmediato (Navbar/fondo/Outlet/Footer),
// sin ningún bootstrap/overlay bloqueante mientras se resuelve el
// branding: es puramente decorativo, nunca condiciona qué se renderiza.
// Cada página (OrganizationProfile/EventDetail/PurchaseWizard) usa su
// propio loading interno mientras carga su contenido — el tema Premium se
// aplica recién cuando `branding` llega, sin bloquear nada antes.
export default function PublicShell() {
  const branding = usePublicBranding();
  const isBranded = Boolean(branding);

  return (
    <div
      className={`flex min-h-screen flex-col overflow-x-hidden bg-[#05070B] ${isBranded ? ORG_THEME_CLASS : ""}`}
    >
      <Navbar />

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
