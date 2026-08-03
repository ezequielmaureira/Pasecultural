import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ScanLine, CheckCircle2, Clock, Ban, AlertTriangle, RefreshCw } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import {
  getScannerInvitation,
  registerScannerInvitation,
  resendScannerVerificationCode,
  verifyScannerInvitationCode,
} from "../../lib/scannerInvitationApi.js";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const DOCUMENT_REGEX = /^\d{7,10}$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeDocument(rawValue) {
  return rawValue.replace(/[\s.-]/g, "");
}

// Pantalla pública que abre quien recibe un link de invitación
// (https://.../scanner/invitacion/:token). Todo el registro y la
// verificación por código de 6 dígitos pasan acá SIN Clerk — recién cuando
// la persona ya quedó activa y quiere entrar a escanear de verdad, inicia
// sesión con Clerk (mismo email) en otra pantalla, ver el bloque ACTIVE
// más abajo.
export default function ScannerInvitationClaim() {
  const { token } = useParams();
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();

  const [invitation, setInvitation] = useState(null);
  const [loadError, setLoadError] = useState("");

  // "form" | "verify" — sólo aplica mientras invitation.status === "INVITED".
  const [step, setStep] = useState("form");
  const [form, setForm] = useState({ firstName: "", lastName: "", document: "", email: "", phone: "" });
  const [documentTouched, setDocumentTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

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

  // Sólo tickea mientras hay un cooldown activo — evita un setInterval
  // corriendo todo el tiempo que la pantalla esté abierta sin necesidad.
  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  const normalizedDocument = normalizeDocument(form.document);
  const isDocumentValid = DOCUMENT_REGEX.test(normalizedDocument);
  const isEmailValid = EMAIL_REGEX.test(form.email.trim());
  const isFormValid = form.firstName.trim() && form.lastName.trim() && isEmailValid && isDocumentValid;
  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  async function handleRegister() {
    if (!isFormValid) return;
    setRegistering(true);
    setRegisterError("");
    try {
      const result = await registerScannerInvitation(token, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        document: normalizedDocument,
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
      });
      setRegisteredEmail(result.email);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setStep("verify");
    } catch (err) {
      setRegisterError(err.message || "No pudimos registrar tus datos.");
    } finally {
      setRegistering(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResendError("");
    try {
      await resendScannerVerificationCode(token);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setResendError(err.message || "No pudimos reenviar el código.");
    } finally {
      setResending(false);
    }
  }

  async function handleVerify() {
    if (!code.trim()) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const result = await verifyScannerInvitationCode(token, code.trim());
      setInvitation((prev) => ({ ...prev, status: result.status }));
    } catch (err) {
      setVerifyError(err.message || "No pudimos verificar el código.");
    } finally {
      setVerifying(false);
    }
  }

  // Mismo criterio de layout que SignIn.jsx/SignUp.jsx: vive dentro de
  // PublicShell (navbar/footer normales), no un fondo propio de pantalla
  // completa.
  function Shell({ children, wide = false }) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
        <div className={`w-full ${wide ? "max-w-sm" : "max-w-sm"}`}>
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

  if (invitation.status === "DISABLED") {
    return (
      <Shell>
        <Ban className="h-9 w-9 text-slate-400" />
        <h1 className="text-lg font-bold text-white">Tu acceso está desactivado</h1>
        <p className="text-sm text-slate-400">Pedile al organizador de "{invitation.eventTitle}" que lo reactive.</p>
      </Shell>
    );
  }

  if (invitation.status === "ACTIVE") {
    const redirect = encodeURIComponent("/scanner");
    return (
      <Shell>
        <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        <h1 className="text-lg font-bold text-white">Ya sos scanner activo</h1>
        <p className="text-sm text-slate-400">
          Tu acceso a "{invitation.eventTitle}" está activo — {invitation.gate}.
        </p>
        {!isLoaded ? (
          <Spinner size="md" />
        ) : isSignedIn ? (
          <Button onClick={() => navigate("/scanner")} className="mt-2 w-full justify-center">
            Ir al scanner
          </Button>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Iniciá sesión con {registeredEmail || "el mismo email con el que te registraste"} para empezar a escanear.
            </p>
            <div className="mt-1 flex w-full flex-col gap-2">
              <Button onClick={() => navigate(`/iniciar-sesion?redirect=${redirect}`)} className="w-full justify-center">
                Iniciar sesión
              </Button>
              <Button variant="secondary" onClick={() => navigate(`/registro?redirect=${redirect}`)} className="w-full justify-center">
                Crear cuenta
              </Button>
            </div>
          </>
        )}
      </Shell>
    );
  }

  // status === "INVITED"
  if (step === "verify") {
    return (
      <Shell>
        <ScanLine className="h-9 w-9 text-violet-400" />
        <h1 className="text-lg font-bold text-white">Ingresá el código</h1>
        <p className="text-sm text-slate-400">
          Te lo mandamos a <span className="font-medium text-slate-200">{registeredEmail}</span>. Vence en 10 minutos.
        </p>

        <div className="mt-2 w-full">
          <Field label="Código de 6 dígitos">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              className={`${inputClass} text-center text-lg tracking-[0.5em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
            />
          </Field>
        </div>

        {verifyError && <p className="text-sm text-rose-400">{verifyError}</p>}

        <Button
          onClick={handleVerify}
          loading={verifying}
          loadingText="Verificando..."
          disabled={code.trim().length !== 6}
          className="mt-1 w-full justify-center"
        >
          Verificar código
        </Button>

        {resendError && <p className="text-xs text-rose-400">{resendError}</p>}
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldownRemaining > 0}
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300 disabled:cursor-not-allowed disabled:text-slate-600"
        >
          <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} />
          {cooldownRemaining > 0 ? `Reenviar código (${cooldownRemaining}s)` : "Reenviar código"}
        </button>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <ScanLine className="h-9 w-9 text-violet-400" />
      <h1 className="text-lg font-bold text-white">Te invitaron a operar como scanner</h1>
      <p className="text-sm text-slate-400">
        <span className="font-medium text-slate-200">{invitation.eventTitle}</span> — {invitation.gate}
      </p>

      <div className="mt-2 flex w-full flex-col gap-3 text-left">
        <Field label="Nombre" required>
          <input
            className={inputClass}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            placeholder="Tu nombre"
            autoComplete="given-name"
          />
        </Field>
        <Field label="Apellido" required>
          <input
            className={inputClass}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            placeholder="Tu apellido"
            autoComplete="family-name"
          />
        </Field>
        <Field label="DNI" required>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={12}
            className={inputClass}
            value={form.document}
            onChange={(e) => {
              setForm({ ...form, document: e.target.value });
              if (e.target.value) setDocumentTouched(true);
            }}
            onBlur={() => setDocumentTouched(true)}
            placeholder="Tu DNI, sin puntos"
          />
          {documentTouched && !isDocumentValid && <p className="text-xs text-rose-400">El DNI tiene que tener entre 7 y 10 números.</p>}
        </Field>
        <Field label="Correo" required>
          <input
            type="email"
            className={inputClass}
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
              if (e.target.value) setEmailTouched(true);
            }}
            onBlur={() => setEmailTouched(true)}
            placeholder="tu@email.com"
            autoComplete="email"
          />
          {emailTouched && !isEmailValid && <p className="text-xs text-rose-400">Ingresá un email válido.</p>}
        </Field>
        <Field label="Teléfono (opcional)">
          <input
            type="tel"
            className={inputClass}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Tu teléfono"
            autoComplete="tel"
          />
        </Field>
      </div>

      {registerError && <p className="text-sm text-rose-400">{registerError}</p>}

      <Button
        onClick={handleRegister}
        loading={registering}
        loadingText="Registrando..."
        disabled={!isFormValid}
        className="mt-2 w-full justify-center"
      >
        Registrar scanner
      </Button>
      <p className="text-xs text-slate-500">Te vamos a mandar un código de verificación a tu correo.</p>
    </Shell>
  );
}
