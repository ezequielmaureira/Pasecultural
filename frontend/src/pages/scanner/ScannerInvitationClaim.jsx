import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ScanLine, CheckCircle2, Clock, Ban, AlertTriangle } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { getScannerInvitation, claimScannerInvitation } from "../../lib/scannerInvitationApi.js";

// Pantalla pública que abre quien recibe un link de invitación
// (https://.../scanner/invitacion/:token) — nunca requiere estar logueado
// para VER de qué evento/puerta se trata, pero sí para aceptarla. Si
// todavía no tiene sesión, manda a iniciar-sesión/registro con `?redirect=`
// de vuelta a esta misma página — nunca a /bienvenida, que la perdería.
export default function ScannerInvitationClaim() {
  const { token } = useParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { backendUser, syncing } = useBackendUser();
  const navigate = useNavigate();
  const location = useLocation();

  const [invitation, setInvitation] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getScannerInvitation(token)
      .then((inv) => {
        if (!cancelled) setInvitation(inv);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || "No pudimos cargar esta invitación.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleClaim() {
    setClaiming(true);
    setClaimError("");
    try {
      const clerkToken = await getToken();
      const result = await claimScannerInvitation(clerkToken, token);
      setInvitation((prev) => ({ ...prev, status: result.status }));
    } catch (err) {
      setClaimError(err.message || "No pudimos aceptar la invitación.");
    } finally {
      setClaiming(false);
    }
  }

  // Mismo criterio de layout que SignIn.jsx/SignUp.jsx: vive dentro de
  // PublicShell (navbar/footer normales), no un fondo propio de pantalla
  // completa — esta página es "un formulario más" del sitio público, no un
  // modo aparte como el Scanner ya autenticado (ScannerShell).
  function Shell({ children }) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <Card>
            <div className="flex flex-col items-center gap-3 py-2 text-center">{children}</div>
          </Card>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <AlertTriangle className="h-9 w-9 text-rose-400" />
        <h1 className="text-lg font-bold text-white">No pudimos abrir esta invitación</h1>
        <p className="text-sm text-slate-400">{loadError}</p>
      </Shell>
    );
  }

  if (!invitation) {
    return (
      <Shell>
        <Spinner size="lg" />
      </Shell>
    );
  }

  if (invitation.status === "EXPIRED") {
    return (
      <Shell>
        <Clock className="h-9 w-9 text-amber-400" />
        <h1 className="text-lg font-bold text-white">Esta invitación venció</h1>
        <p className="text-sm text-slate-400">Pedile al organizador de "{invitation.eventTitle}" que te mande una nueva.</p>
      </Shell>
    );
  }

  if (invitation.status === "REVOKED") {
    return (
      <Shell>
        <Ban className="h-9 w-9 text-rose-400" />
        <h1 className="text-lg font-bold text-white">Esta invitación fue cancelada</h1>
        <p className="text-sm text-slate-400">El organizador de "{invitation.eventTitle}" la canceló.</p>
      </Shell>
    );
  }

  if (!isLoaded) {
    return (
      <Shell>
        <Spinner size="lg" />
      </Shell>
    );
  }

  if (!isSignedIn) {
    const redirect = encodeURIComponent(location.pathname);
    return (
      <Shell>
        <ScanLine className="h-9 w-9 text-violet-400" />
        <h1 className="text-lg font-bold text-white">Invitación para operar como scanner</h1>
        <p className="text-sm text-slate-400">
          <span className="font-medium text-slate-200">{invitation.eventTitle}</span> — {invitation.gate}
        </p>
        <p className="text-xs text-slate-500">Iniciá sesión o creá una cuenta para aceptarla.</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button onClick={() => navigate(`/iniciar-sesion?redirect=${redirect}`)} className="w-full justify-center">
            Iniciar sesión
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/registro?redirect=${redirect}`)} className="w-full justify-center">
            Crear cuenta
          </Button>
        </div>
      </Shell>
    );
  }

  if (syncing) {
    return (
      <Shell>
        <Spinner size="lg" />
        <p className="text-sm text-slate-400">Preparando tu cuenta...</p>
      </Shell>
    );
  }

  if (invitation.status === "PENDING") {
    return (
      <Shell>
        <Clock className="h-9 w-9 text-amber-400" />
        <h1 className="text-lg font-bold text-white">Tu solicitud está pendiente</h1>
        <p className="text-sm text-slate-400">
          Le avisamos al organizador de "{invitation.eventTitle}". Vas a poder escanear apenas la apruebe.
        </p>
      </Shell>
    );
  }

  if (invitation.status === "ACTIVE") {
    return (
      <Shell>
        <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        <h1 className="text-lg font-bold text-white">Ya podés escanear</h1>
        <p className="text-sm text-slate-400">
          Tu acceso a "{invitation.eventTitle}" está activo — {invitation.gate}.
        </p>
        <Button onClick={() => navigate("/scanner")} className="mt-2 w-full justify-center">
          Ir al scanner
        </Button>
      </Shell>
    );
  }

  if (invitation.status === "DISABLED") {
    return (
      <Shell>
        <Ban className="h-9 w-9 text-slate-400" />
        <h1 className="text-lg font-bold text-white">Tu acceso está desactivado</h1>
        <p className="text-sm text-slate-400">Pedile al organizador de "{invitation.eventTitle}" que lo reactive.</p>
      </Shell>
    );
  }

  // status === "INVITED": el único caso donde todavía hace falta aceptar.
  return (
    <Shell>
      <ScanLine className="h-9 w-9 text-violet-400" />
      <h1 className="text-lg font-bold text-white">Te invitaron a operar como scanner</h1>
      <p className="text-sm text-slate-400">
        <span className="font-medium text-slate-200">{invitation.eventTitle}</span> — {invitation.gate}
      </p>
      {backendUser?.firstName && (
        <p className="text-xs text-slate-500">Vas a aceptar con la cuenta de {backendUser.firstName}.</p>
      )}
      {claimError && <p className="text-sm text-rose-400">{claimError}</p>}
      <Button onClick={handleClaim} loading={claiming} loadingText="Aceptando..." className="mt-2 w-full justify-center">
        Aceptar invitación
      </Button>
      <p className="text-xs text-slate-500">
        Después de aceptar, el organizador todavía tiene que aprobar tu acceso antes de que puedas escanear.
      </p>
    </Shell>
  );
}
