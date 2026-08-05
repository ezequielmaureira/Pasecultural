import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, RefreshCw } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { requestScannerLoginCode, resendScannerLoginCode, verifyScannerLoginCode } from "../../lib/scannerAuthApi.js";
import { writeScannerSessionToken } from "../../lib/scannerSessionStorage.js";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Definido a nivel de módulo, NO dentro de ScannerPortal — el mismo cuidado
// que ScannerInvitationClaim.jsx: un componente definido dentro de otro se
// recrea en cada render (cada tecla tipeada) y React lo trata como un tipo
// distinto, desmontando el subárbol — eso es lo que le cierra el teclado en
// Android.
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

// "Soy Scanner" — Portal de acceso RECURRENTE para un scanner ya
// registrado (ver ScannerInvitationClaim.jsx para el registro único por
// invitación). Sin Clerk, sin cuentas, sin contraseña: sólo email + código
// de 6 dígitos, reutilizando la misma infraestructura de verificación y el
// mismo scannerSessionToken que ya emite el registro.
export default function ScannerPortal() {
  const navigate = useNavigate();

  // "email" | "code"
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Sólo tickea mientras hay un cooldown activo — mismo criterio que
  // ScannerInvitationClaim.jsx/RecoverPurchase.jsx.
  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  const isEmailValid = EMAIL_REGEX.test(email.trim());
  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  async function handleContinue() {
    if (!isEmailValid) return;
    setRequesting(true);
    setRequestError("");
    try {
      await requestScannerLoginCode(email.trim());
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      setVerifyError("");
      setStep("code");
    } catch (err) {
      setRequestError(err.message || "No pudimos enviar el código.");
    } finally {
      setRequesting(false);
    }
  }

  async function handleVerify() {
    if (code.trim().length !== 6) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const result = await verifyScannerLoginCode(email.trim(), code.trim());
      // Guardar y redirigir de una — el scannerSessionToken YA es el acceso
      // completo, sin pantalla intermedia de "iniciar sesión".
      writeScannerSessionToken(result.scannerSessionToken);
      navigate("/scanner", { replace: true });
    } catch (err) {
      setVerifyError(err.message || "No pudimos verificar el código.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResendError("");
    try {
      await resendScannerLoginCode(email.trim());
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setResendError(err.message || "No pudimos reenviar el código.");
    } finally {
      setResending(false);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setCode("");
    setVerifyError("");
    setResendError("");
    setResendCooldownUntil(0);
  }

  if (step === "code") {
    return (
      <Shell>
        <ScanLine className="h-9 w-9 text-violet-400" />
        <h1 className="text-lg font-bold text-white">Ingresá el código</h1>
        <p className="text-sm text-slate-400">
          Te lo mandamos a <span className="font-medium text-slate-200">{email.trim()}</span>. Vence en 10 minutos.
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
          Verificar
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

        <button
          type="button"
          onClick={handleChangeEmail}
          className="mt-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
        >
          Cambiar correo
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <ScanLine className="h-9 w-9 text-violet-400" />
      <h1 className="text-lg font-bold text-white">Soy Scanner</h1>
      <p className="text-sm text-slate-400">Ingresá el correo con el que fuiste registrado por el organizador.</p>

      <div className="mt-2 w-full">
        <Field label="Correo electrónico">
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (e.target.value) setEmailTouched(true);
            }}
            onBlur={() => setEmailTouched(true)}
            placeholder="tu@email.com"
            autoComplete="email"
            onKeyDown={(e) => e.key === "Enter" && handleContinue()}
          />
          {emailTouched && !isEmailValid && <p className="text-xs text-rose-400">Ingresá un email válido.</p>}
        </Field>
      </div>

      {requestError && <p className="text-sm text-rose-400">{requestError}</p>}

      <Button
        onClick={handleContinue}
        loading={requesting}
        loadingText="Enviando..."
        disabled={!isEmailValid}
        className="mt-1 w-full justify-center"
      >
        Continuar
      </Button>
    </Shell>
  );
}
