import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import PublicShell from "./components/layout/PublicShell.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import RoleGuard from "./components/auth/RoleGuard.jsx";
import Home from "./pages/Home.jsx";
import OrganizersLanding from "./pages/OrganizersLanding.jsx";
import SignInPage from "./pages/SignIn.jsx";
import SignUpPage from "./pages/SignUp.jsx";
import PostAuth from "./pages/PostAuth.jsx";
import OrganizerOnboarding from "./pages/organizer/OrganizerOnboarding.jsx";
import HowItWorks from "./pages/HowItWorks.jsx";
import Profile from "./pages/Profile.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { OrganizerDataProvider } from "./context/OrganizerDataContext.jsx";
import { ActiveEventProvider } from "./context/ActiveEventContext.jsx";
import DashboardDeveloper from "./pages/DashboardDeveloper.jsx";
import DeveloperOrganizations from "./pages/developer/DeveloperOrganizations.jsx";
import DeveloperUsers from "./pages/developer/DeveloperUsers.jsx";
import DeveloperDatabase from "./pages/developer/DeveloperDatabase.jsx";
import DeveloperEvents from "./pages/developer/DeveloperEvents.jsx";
import DeveloperTickets from "./pages/developer/DeveloperTickets.jsx";
import ScannerShell from "./pages/scanner/ScannerShell.jsx";
import ScannerHome from "./pages/scanner/ScannerHome.jsx";
import ScannerInvitationClaim from "./pages/scanner/ScannerInvitationClaim.jsx";
import ScannerPortal from "./pages/scanner/ScannerPortal.jsx";
import EventsList from "./pages/public/EventsList.jsx";
import EventDetail from "./pages/public/EventDetail.jsx";
import PurchaseWizard from "./pages/public/purchase/PurchaseWizard.jsx";
import MyTickets from "./pages/public/MyTickets.jsx";
import RecoverPurchase from "./pages/public/RecoverPurchase.jsx";
import OrganizerDashboard from "./pages/organizer/OrganizerDashboard.jsx";
import OrganizerEvents from "./pages/organizer/OrganizerEvents.jsx";
import OrganizerEventWizard from "./pages/organizer/OrganizerEventWizard.jsx";
import OrganizerEventChat from "./pages/organizer/OrganizerEventChat.jsx";
import OrganizerTickets from "./pages/organizer/OrganizerTickets.jsx";
import OrganizerTicketTypes from "./pages/organizer/OrganizerTicketTypes.jsx";
import OrganizerSales from "./pages/organizer/OrganizerSales.jsx";
import OrganizerCourtesies from "./pages/organizer/OrganizerCourtesies.jsx";
import IssueCourtesyWizard from "./pages/organizer/courtesies/IssueCourtesyWizard.jsx";
import CourtesyHistory from "./pages/organizer/courtesies/CourtesyHistory.jsx";
import OrganizerScanners from "./pages/organizer/OrganizerScanners.jsx";
import OrganizerScannerInvite from "./pages/organizer/OrganizerScannerInvite.jsx";
import OrganizerSettings from "./pages/organizer/OrganizerSettings.jsx";
import OrganizerFunctionStatus from "./pages/organizer/OrganizerFunctionStatus.jsx";
import OrganizerEventHistory from "./pages/organizer/OrganizerEventHistory.jsx";

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
        <Routes>
          <Route element={<PublicShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/eventos" element={<EventsList />} />
            <Route path="/evento/:slug" element={<EventDetail />} />
            {/* Sin RequireAuth a propósito: comprar nunca exige cuenta. */}
            <Route path="/comprar" element={<PurchaseWizard />} />
            <Route element={<RequireAuth />}>
              <Route path="/mis-entradas" element={<MyTickets />} />
            </Route>
            <Route path="/recuperar-compra" element={<RecoverPurchase />} />
            {/* Público a propósito: tiene que mostrar "vas a operar como
                scanner de X" antes del login — RequireAuth la mandaría
                directo a /iniciar-sesion sin ese contexto. La propia
                pantalla pide sesión sólo para el botón "Aceptar". */}
            <Route path="/scanner/invitacion/:token" element={<ScannerInvitationClaim />} />
            {/* Acceso RECURRENTE de un scanner ya registrado — "Soy Scanner"
                desde el Home. Email + código de 6 dígitos, misma
                credencial (scannerSessionToken) que ya emite el registro
                por invitación. También pública, mismo criterio. */}
            <Route path="/scanner/portal" element={<ScannerPortal />} />
            <Route path="/para-organizadores" element={<OrganizersLanding />} />
            <Route path="/como-funciona" element={<HowItWorks />} />
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
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
