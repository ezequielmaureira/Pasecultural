import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import PublicShell from "./components/layout/PublicShell.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import Home from "./pages/Home.jsx";
import OrganizersLanding from "./pages/OrganizersLanding.jsx";
import SignInPage from "./pages/SignIn.jsx";
import SignUpPage from "./pages/SignUp.jsx";
import PostAuth from "./pages/PostAuth.jsx";
import OrganizerOnboarding from "./pages/organizer/OrganizerOnboarding.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { OrganizerDataProvider } from "./context/OrganizerDataContext.jsx";
import DashboardDeveloper from "./pages/DashboardDeveloper.jsx";
import DashboardScanner from "./pages/DashboardScanner.jsx";
import DashboardCustomer from "./pages/DashboardCustomer.jsx";
import OrganizerDashboard from "./pages/organizer/OrganizerDashboard.jsx";
import OrganizerEvents from "./pages/organizer/OrganizerEvents.jsx";
import OrganizerEventForm from "./pages/organizer/OrganizerEventForm.jsx";
import OrganizerTickets from "./pages/organizer/OrganizerTickets.jsx";
import OrganizerSales from "./pages/organizer/OrganizerSales.jsx";
import OrganizerScanners from "./pages/organizer/OrganizerScanners.jsx";
import OrganizerSettings from "./pages/organizer/OrganizerSettings.jsx";

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
      <AuthProvider>
        <Routes>
          <Route element={<PublicShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/para-organizadores" element={<OrganizersLanding />} />
            <Route path="/iniciar-sesion" element={<SignInPage />} />
            <Route path="/registro" element={<SignUpPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/bienvenida" element={<PostAuth />} />
            <Route
              path="/organizador/nueva-organizacion"
              element={<OrganizerOnboarding />}
            />

            <Route element={<AppShell />}>
              <Route path="/developer" element={<DashboardDeveloper />} />

              <Route
                path="/organizador"
                element={
                  <OrganizerDataProvider>
                    <Outlet />
                  </OrganizerDataProvider>
                }
              >
                <Route index element={<OrganizerDashboard />} />
                <Route path="eventos" element={<OrganizerEvents />} />
                <Route path="eventos/nuevo" element={<OrganizerEventForm />} />
                <Route path="eventos/:id/editar" element={<OrganizerEventForm />} />
                <Route path="entradas" element={<OrganizerTickets />} />
                <Route path="ventas" element={<OrganizerSales />} />
                <Route path="scanners" element={<OrganizerScanners />} />
                <Route path="configuracion" element={<OrganizerSettings />} />
              </Route>

              <Route path="/scanner" element={<DashboardScanner />} />
              <Route path="/usuario" element={<DashboardCustomer />} />

              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
