import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import PublicShell from "./components/layout/PublicShell.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import RoleGuard from "./components/auth/RoleGuard.jsx";
import PreLaunchGate from "./components/launch/PreLaunchGate.jsx";
import Home from "./pages/Home.jsx";
import OrganizersLanding from "./pages/OrganizersLanding.jsx";
import SignInPage from "./pages/SignIn.jsx";
import SignUpPage from "./pages/SignUp.jsx";
import PostAuth from "./pages/PostAuth.jsx";
import HowItWorks from "./pages/HowItWorks.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import DataDeletion from "./pages/DataDeletion.jsx";
import Profile from "./pages/Profile.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { OrganizerSessionProvider } from "./context/OrganizerSessionContext.jsx";
import { OrganizerDataProvider } from "./context/OrganizerDataContext.jsx";
import { ActiveEventProvider } from "./context/ActiveEventContext.jsx";
import OrganizerWhatsAppShortcutButton from "./components/organizer/OrganizerWhatsAppShortcutButton.jsx";
import EventsList from "./pages/public/EventsList.jsx";
import EventDetail from "./pages/public/EventDetail.jsx";
import OrganizationProfile from "./pages/public/OrganizationProfile.jsx";
import OrganizationsList from "./pages/public/OrganizationsList.jsx";
import PurchaseWizard from "./pages/public/purchase/PurchaseWizard.jsx";
import MyTickets from "./pages/public/MyTickets.jsx";
import RecoverPurchase from "./pages/public/RecoverPurchase.jsx";
import WithdrawalRequest from "./pages/public/WithdrawalRequest.jsx";

// --- Developer (lazy: panel privado, bajo demanda) ---
const DashboardDeveloper = lazy(() => import("./pages/DashboardDeveloper.jsx"));
const DeveloperOrganizations = lazy(() => import("./pages/developer/DeveloperOrganizations.jsx"));
const DeveloperUsers = lazy(() => import("./pages/developer/DeveloperUsers.jsx"));
const DeveloperDatabase = lazy(() => import("./pages/developer/DeveloperDatabase.jsx"));
const DeveloperEvents = lazy(() => import("./pages/developer/DeveloperEvents.jsx"));
const DeveloperTickets = lazy(() => import("./pages/developer/DeveloperTickets.jsx"));
const DeveloperScanners = lazy(() => import("./pages/developer/DeveloperScanners.jsx"));
const DeveloperSales = lazy(() => import("./pages/developer/DeveloperSales.jsx"));
const DeveloperSettings = lazy(() => import("./pages/developer/DeveloperSettings.jsx"));
const DeveloperPlans = lazy(() => import("./pages/developer/DeveloperPlans.jsx"));

// --- Scanner (lazy: panel privado, bajo demanda) ---
const ScannerShell = lazy(() => import("./pages/scanner/ScannerShell.jsx"));
const ScannerHome = lazy(() => import("./pages/scanner/ScannerHome.jsx"));
const ScannerInvitationClaim = lazy(() => import("./pages/scanner/ScannerInvitationClaim.jsx"));
const ScannerPortal = lazy(() => import("./pages/scanner/ScannerPortal.jsx"));

// --- Organizer (lazy: panel privado, bajo demanda) ---
const OrganizerOnboarding = lazy(() => import("./pages/organizer/OrganizerOnboarding.jsx"));
const OrganizerDashboard = lazy(() => import("./pages/organizer/OrganizerDashboard.jsx"));
const OrganizerEvents = lazy(() => import("./pages/organizer/OrganizerEvents.jsx"));
const OrganizerEventWizard = lazy(() => import("./pages/organizer/OrganizerEventWizard.jsx"));
const OrganizerEventChat = lazy(() => import("./pages/organizer/OrganizerEventChat.jsx"));
const OrganizerTickets = lazy(() => import("./pages/organizer/OrganizerTickets.jsx"));
const OrganizerTicketTypes = lazy(() => import("./pages/organizer/OrganizerTicketTypes.jsx"));
const OrganizerSales = lazy(() => import("./pages/organizer/OrganizerSales.jsx"));
const OrganizerCourtesies = lazy(() => import("./pages/organizer/OrganizerCourtesies.jsx"));
const IssueCourtesyWizard = lazy(() => import("./pages/organizer/courtesies/IssueCourtesyWizard.jsx"));
const CourtesyHistory = lazy(() => import("./pages/organizer/courtesies/CourtesyHistory.jsx"));
const OrganizerScanners = lazy(() => import("./pages/organizer/OrganizerScanners.jsx"));
const OrganizerScannerInvite = lazy(() => import("./pages/organizer/OrganizerScannerInvite.jsx"));
const OrganizerSettings = lazy(() => import("./pages/organizer/OrganizerSettings.jsx"));
const OrganizerFunctionStatus = lazy(() => import("./pages/organizer/OrganizerFunctionStatus.jsx"));
const OrganizerEventHistory = lazy(() => import("./pages/organizer/OrganizerEventHistory.jsx"));
const OrganizerWithdrawalRequests = lazy(() => import("./pages/organizer/OrganizerWithdrawalRequests.jsx"));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm">Cargando...</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-semibold text-white">Página no encontrada</p>
      <p className="text-sm text-slate-400">
        Esta sección todavía no está disponible.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <AuthProvider>
      <ThemeProvider>
      <OrganizerSessionProvider>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Modo Prelanzamiento — SOLO las rutas comerciales/de descubrimiento
              quedan detrás de PreLaunchGate (ver ese componente). El resto de
              PublicShell (login, legal, informativas) vive en un segundo
              bloque más abajo, deliberadamente FUERA de este gate: es el
              camino que Developer/Organizer necesitan conservar siempre
              disponible para poder autenticarse. */}
          <Route element={<PreLaunchGate />}>
            <Route element={<PublicShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/eventos" element={<EventsList />} />
              <Route path="/evento/:slug" element={<EventDetail />} />
              <Route path="/organizacion/:slug" element={<OrganizationProfile />} />
              <Route path="/organizaciones" element={<OrganizationsList />} />
              {/* Sin RequireAuth a propósito: comprar nunca exige cuenta. */}
              <Route path="/comprar" element={<PurchaseWizard />} />
              <Route element={<RequireAuth />}>
                <Route path="/mis-entradas" element={<MyTickets />} />
              </Route>
              <Route path="/recuperar-compra" element={<RecoverPurchase />} />
              <Route path="/arrepentimiento" element={<WithdrawalRequest />} />
            </Route>
          </Route>

          <Route element={<PublicShell />}>
            {/* Público a propósito: tiene que mostrar "vas a operar como
                scanner de X" antes del login — RequireAuth la mandaría
                directo a /iniciar-sesion sin ese contexto. La propia
                pantalla pide sesión sólo para el botón "Aceptar". No detrás
                de PreLaunchGate: es operativo (scanners ya invitados por un
                organizador), nunca descubrimiento de eventos para un
                visitante anónimo. */}
            <Route path="/scanner/invitacion/:token" element={<ScannerInvitationClaim />} />
            {/* Acceso RECURRENTE de un scanner ya registrado — "Soy Scanner"
                desde el Home. Email + código de 6 dígitos, misma
                credencial (scannerSessionToken) que ya emite el registro
                por invitación. También pública, mismo criterio. */}
            <Route path="/scanner/portal" element={<ScannerPortal />} />
            <Route path="/para-organizadores" element={<OrganizersLanding />} />
            <Route path="/como-funciona" element={<HowItWorks />} />
            {/* Páginas legales públicas requeridas por Meta para publicar la
                app de WhatsApp Business — sin auth, mismo patrón que
                /como-funciona. */}
            <Route path="/privacidad" element={<PrivacyPolicy />} />
            <Route path="/eliminacion-de-datos" element={<DataDeletion />} />
            <Route path="/perfil" element={<Profile />} />
            <Route path="/iniciar-sesion" element={<SignInPage />} />
            <Route path="/registro" element={<SignUpPage />} />
          </Route>

          {/* Fuera de RequireAuth a propósito: el módulo Scanner no usa
              Clerk en absoluto — la única credencial es el
              scannerSessionToken que se guarda en el navegador al verificar
              el código de la invitación (ver ScannerInvitationClaim.jsx).
              ScannerHome maneja "sin sesión" del lado del cliente y cada
              endpoint la vuelve a validar del lado del servidor
              (requireScannerSession). */}
          <Route path="/scanner" element={<ScannerShell />}>
            <Route index element={<ScannerHome />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/bienvenida" element={<PostAuth />} />
            <Route
              path="/organizador/nueva-organizacion"
              element={<OrganizerOnboarding />}
            />

            <Route element={<AppShell />}>
              <Route element={<RoleGuard allowedRoles={["developer"]} />}>
                <Route path="/developer" element={<DashboardDeveloper />} />
                <Route
                  path="/developer/organizaciones"
                  element={<DeveloperOrganizations />}
                />
                <Route path="/developer/usuarios" element={<DeveloperUsers />} />
                <Route path="/developer/eventos" element={<DeveloperEvents />} />
                <Route path="/developer/entradas" element={<DeveloperTickets />} />
                <Route path="/developer/scanners" element={<DeveloperScanners />} />
                <Route path="/developer/ventas" element={<DeveloperSales />} />
                <Route path="/developer/planes" element={<DeveloperPlans />} />
                <Route path="/developer/configuracion" element={<DeveloperSettings />} />
                <Route path="/developer/base-de-datos" element={<DeveloperDatabase />} />
              </Route>

              <Route element={<RoleGuard allowedRoles={["organizer"]} />}>
                <Route
                  path="/organizador"
                  element={
                    <OrganizerDataProvider>
                      <ActiveEventProvider>
                        <Outlet />
                      </ActiveEventProvider>
                    </OrganizerDataProvider>
                  }
                >
                  <Route index element={<OrganizerDashboard />} />
                  <Route path="eventos" element={<OrganizerEvents />} />
                  <Route path="eventos/nuevo" element={<OrganizerEventChat />} />
                  <Route path="eventos/:id/editar" element={<OrganizerEventWizard />} />
                  <Route path="entradas" element={<OrganizerTickets />} />
                  <Route path="tipos-de-entrada" element={<OrganizerTicketTypes />} />
                  <Route path="cortesias" element={<OrganizerCourtesies />} />
                  <Route path="cortesias/emitir" element={<IssueCourtesyWizard />} />
                  <Route path="cortesias/historial" element={<CourtesyHistory />} />
                  <Route path="ventas" element={<OrganizerSales />} />
                  <Route path="solicitudes" element={<OrganizerWithdrawalRequests />} />
                  <Route path="scanners" element={<OrganizerScanners />} />
                  <Route path="scanners/nuevo" element={<OrganizerScannerInvite />} />
                  <Route path="funciones" element={<OrganizerFunctionStatus />} />
                  <Route path="historial" element={<OrganizerEventHistory />} />
                  <Route path="configuracion" element={<OrganizerSettings />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
        {/* Atajo global "Cargá tu evento con WhatsApp" — montado UNA sola
            vez acá, junto a <Routes> (nunca dentro de una rama de rutas),
            para que un Organizer autenticado lo siga viendo sin importar si
            está en su panel o en cualquier pantalla pública de Smarticket. */}
        <OrganizerWhatsAppShortcutButton />
      </OrganizerSessionProvider>
      </ThemeProvider>
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
