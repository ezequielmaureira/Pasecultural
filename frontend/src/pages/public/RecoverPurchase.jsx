import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CalendarDays, MapPin, RefreshCw } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { requestSaleRecoveryCode, resendSaleRecoveryCode, verifySaleRecoveryCode } from "../../lib/saleApi.js";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const DOCUMENT_REGEX = /^\d{7,10}$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Mismo criterio que BuyerInfoStep.jsx: el DNI se puede escribir con
// puntos/espacios/guiones, se limpia antes de validar y de mandar al
// backend (que además normaliza de nuevo del lado servidor).
function normalizeDocument(rawValue) {
  return rawValue.replace(/[\s.-]/g, "");
}

function formatFunctionDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Date(isoDate).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" });
  } catch {
    return isoDate;
  }
}

// Pantalla pública "Recuperar mis entradas": email+DNI sólo LOCALIZAN una
// compra propia, nunca la autorizan a verse — nunca se muestra evento,
// fecha, cantidad de entradas, QR ni PDF antes de verificar un código de 6
// dígitos mandado al correo registrado (ver saleRecoveryVerification.service.js
// en el backend). Recién con el código correcto se revela el resultado y,
// si hay una única compra, se redirige a /comprar?saleToken=... — el MISMO
// camino de recuperación que ya usa PurchaseWizard después de una compra o
// recarga de página. No arma ninguna pantalla de tickets/QR/PDF propia:
// PurchaseWizard + SuccessStep ya hacen exactamente eso, reutilizados tal
// cual, sin duplicar nada.
export default function RecoverPurchase() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  // Nunca "document" a secas: taparía el `document` global del navegador.
  const [buyerDocument, setBuyerDocument] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [documentTouched, setDocumentTouched] = useState(false);

  // "form" | "requesting" | "code" | "no-matches" | "multiple" | "error"
  const [status, setStatus] = useState("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [matches, setMatches] = useState([]);

  // Paso 2: verificación del código de 6 dígitos — mismo patrón de estado
  // que ScannerInvitationClaim.jsx (instancia propia, no compartida).
  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Sólo tickea mientras hay un cooldown activo — evita un setInterval
  // corriendo todo el tiempo que la pantalla esté abierta sin necesidad.
  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  const normalizedDocument = normalizeDocument(buyerDocument);
  const isEmailValid = EMAIL_REGEX.test(email.trim());
  const isDocumentValid = DOCUMENT_REGEX.test(normalizedDocument);
  const isValid = isEmailValid && isDocumentValid;
  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  async function handleSearch() {
    if (!isValid) return;
    setStatus("requesting");
    setErrorMessage("");
    try {
      const result = await requestSaleRecoveryCode({ email: email.trim(), buyerDocument: normalizedDocument });
      setMaskedEmail(result);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      setVerifyError("");
      setStatus("code");
    } catch (err) {
      setErrorMessage(err.message || "No pudimos buscar tu compra. Probá de nuevo en unos minutos.");
      setStatus("error");
    }
  }

  async function handleVerify() {
    if (code.trim().length !== 6) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const sales = await verifySaleRecoveryCode({ email: email.trim(), buyerDocument: normalizedDocument, code: code.trim() });
      if (sales.length === 0) {
        setStatus("no-matches");
      } else if (sales.length === 1) {
        navigate(`/comprar?saleToken=${encodeURIComponent(sales[0].recoveryToken)}`);
      } else {
        setMatches(sales);
        setStatus("multiple");
      }
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
      const result = await resendSaleRecoveryCode({ email: email.trim(), buyerDocument: normalizedDocument });
      setMaskedEmail(result);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setResendError(err.message || "No pudimos reenviar el código.");
    } finally {
      setResending(false);
    }
  }

  function handleTryAgain() {
    setStatus("form");
    setErrorMessage("");
    setMatches([]);
    setCode("");
    setVerifyError("");
    setResendError("");
    setResendCooldownUntil(0);
  }

  if (status === "requesting") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Buscando tu compra...</p>
      </div>
    );
  }

  if (status === "code") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Search className="h-9 w-9 text-violet-400" />
            <h1 className="text-lg font-bold text-white">Encontramos una compra asociada a esos datos.</h1>
            <p className="text-sm text-slate-400">
              Te enviamos un código de verificación al correo registrado:{" "}
              <span className="font-medium text-slate-200">{maskedEmail}</span>.
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
              onClick={handleTryAgain}
              className="mt-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
            >
              Usar otro correo o DNI
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "multiple") {
    return (
      <div className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-10">
        <Card>
          <div className="flex flex-col gap-1 pb-4 text-center">
            <h1 className="text-lg font-bold text-white">Encontramos {matches.length} compras</h1>
            <p className="text-sm text-slate-400">Elegí cuál querés ver</p>
          </div>
          <div className="flex flex-col gap-3">
            {matches.map((sale) => (
              <div
                key={sale.recoveryToken}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{sale.eventTitle}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    {formatFunctionDate(sale.functionDate)}
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {sale.venue}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => navigate(`/comprar?saleToken=${encodeURIComponent(sale.recoveryToken)}`)}
                >
                  Ver entradas
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={handleTryAgain} className="mt-5 w-full justify-center">
            Buscar de nuevo
          </Button>
        </Card>
      </div>
    );
  }

  if (status === "no-matches") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <h1 className="text-lg font-bold text-white">No encontramos ninguna compra con esos datos.</h1>
            <p className="text-sm text-slate-400">
              Revisá que el email y el DNI sean exactamente los que usaste al comprar.
            </p>
            <Button onClick={handleTryAgain} className="mt-2 w-full justify-center">
              Intentar de nuevo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
      <Card>
        <div className="flex flex-col gap-1 pb-4 text-center">
          <h1 className="text-lg font-bold text-white">Recuperar mis entradas</h1>
          <p className="text-sm text-slate-400">Ingresá el email y el DNI que usaste al comprar</p>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Email" required>
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
            />
            {emailTouched && !isEmailValid && <p className="text-xs text-rose-400">Ingresá un email válido.</p>}
          </Field>
          <Field label="DNI" required>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={12}
              className={inputClass}
              value={buyerDocument}
              onChange={(e) => {
                setBuyerDocument(e.target.value);
                if (e.target.value) setDocumentTouched(true);
              }}
              onBlur={() => setDocumentTouched(true)}
              placeholder="Tu DNI, sin puntos"
            />
            {documentTouched && !isDocumentValid && (
              <p className="text-xs text-rose-400">El DNI tiene que tener entre 7 y 10 números.</p>
            )}
          </Field>

          {status === "error" && <p className="text-xs text-rose-400">{errorMessage}</p>}

          <Button disabled={!isValid} onClick={handleSearch} className="mt-1 w-full justify-center gap-1.5">
            <Search className="h-4 w-4" />
            Buscar mi compra
          </Button>
        </div>
      </Card>
    </div>
  );
}
