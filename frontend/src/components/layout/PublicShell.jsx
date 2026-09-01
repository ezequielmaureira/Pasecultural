import { Outlet } from "react-router-dom";
import Navbar from "../navbar/Navbar.jsx";
import Footer from "./Footer.jsx";
import { usePublicBranding, usePublicBrandingResolving } from "../../context/PublicBrandingContext.jsx";
import { ORG_THEME_CLASS } from "../../lib/organizationTheme.js";
import BootstrapScreen from "../shared/BootstrapScreen.jsx";

// La autoridad de branding público sigue siendo exclusivamente
// `usePublicBranding()` (ya la consume Navbar) — nunca logo/slug/color.
// Antes sólo Navbar aplicaba `.org-theme` sobre su propio <header>; el resto
// del viewport (fondo exterior, laterales, Footer) seguía en dark aunque la
// Organization fuera Premium, dejando el contenido central "incrustado"
// sobre un marco negro. Aplicando la misma clase acá, en el wrapper que
// envuelve Navbar + Outlet + Footer, el Light Theme cubre TODO el viewport
// público de una Organization Premium de una sola vez — Footer no necesita
// ningún cambio propio porque sus clases (border-white/5, text-white,
// text-slate-400/500) ya están cubiertas por el remapeo scoped existente.
//
// `isResolving` cierra el flash "dark → fetch → light": mientras
// OrganizationProfile/EventDetail/PurchaseWizard todavía no saben si la
// Organization es Premium, cubrimos TODO (Navbar/fondo/Outlet/Footer) con
// el mismo BootstrapScreen neutro que ya usa AppShell — NUNCA se
// desmonta Navbar/Outlet/Footer para lograrlo (eso generaría un loop:
// la página que reporta "pending" se desmontaría a sí misma y dejaría de
// poder reportar "ya resolví"), se los cubre con un overlay opaco de
// viewport completo mientras siguen montados resolviendo por detrás. El
// usuario nunca ve ni un píxel del estado intermedio: BootstrapScreen es
// `fixed inset-0 z-50` (más alto que el `z-20` del Navbar `sticky`).
// Home, /eventos y cualquier ruta que no llame a
// `useRegisterPublicBrandingPending` nunca activan esto.
export default function PublicShell() {
  const branding = usePublicBranding();
  const isResolving = usePublicBrandingResolving();
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

      {isResolving && <BootstrapScreen />}
    </div>
  );
}
