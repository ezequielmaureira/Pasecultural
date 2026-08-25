import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CalendarDays, MapPin, RefreshCw, CheckCircle2, Ticket, Mail, Download, Receipt, Clock3, ArrowLeft } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import {
  requestSaleRecoveryCode,
  resendSaleRecoveryCode,
  verifySaleRecoveryCode,
  resendSaleEmail,
  downloadSalePdf,
  requestPaymentRecoveryCode,
  resendPaymentRecoveryCode,
  verifyPaymentRecoveryCode,
} from "../../lib/saleApi.js";

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

function BackLink({ onBack, label = "Elegir otra opción" }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
    >
      <ArrowLeft className="h-3 w-3" />
      {label}
    </button>
  );
}

// Pantalla pública "Recuperar mis entradas" — punto de entrada con dos
// caminos claramente diferenciados (ronda "recuperación de pagos", parte
// 2): "Reenviar mis entradas" (ResendTicketsFlow, EL MISMO flujo de
// siempre, sin cambios de comportamiento) y "Pagué pero no recibí mis
// entradas" (PaymentRecoveryFlow, nuevo). Ninguno de los dos revela nada de
// una compra real antes de un código OTP correcto.
export default function RecoverPurchase() {
  const [mode, setMode] = useState(null); // null | "resend" | "payment"

  if (mode === "resend") return <ResendTicketsFlow onBack={() => setMode(null)} />;
  if (mode === "payment") return <PaymentRecoveryFlow onBack={() => setMode(null)} />;

  return (
    <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
      <Card>
        <div className="flex flex-col gap-1 pb-4 text-center">
          <h1 className="text-lg font-bold text-white">Recuperar mis entradas</h1>
          <p className="text-sm text-slate-400">Elegí qué necesitás hacer</p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setMode("resend")}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-left transition-colors duration-150 hover:bg-white/10"
          >
            <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-violet-400" />
            <div>
              <p className="text-sm font-semibold text-white">Reenviar mis entradas</p>
              <p className="mt-0.5 text-xs text-slate-400">Ya tenés tu compra confirmada y querés volver a verla o recibirla por correo.</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("payment")}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-left transition-colors duration-150 hover:bg-white/10"
          >
            <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-violet-400" />
            <div>
              <p className="text-sm font-semibold text-white">Pagué pero no recibí mis entradas</p>
              <p className="mt-0.5 text-xs text-slate-400">Mercado Pago te cobró, pero nunca llegaste a ver la compra confirmada.</p>
            </div>
          </button>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// "Reenviar mis entradas" — flujo EXISTENTE, movido tal cual a su propio
// componente (mismo estado, mismos handlers, misma UI) para poder convivir
// con la opción nueva sin tocar su comportamiento. Único agregado: un link
// "Elegir otra opción" en la pantalla inicial.
// ============================================================================
function ResendTicketsFlow({ onBack }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  // Nunca "document" a secas: taparía el `document` global del navegador.
  const [buyerDocument, setBuyerDocument] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [documentTouched, setDocumentTouched] = useState(false);

  // "form" | "requesting" | "code" | "found" | "no-matches" | "multiple" | "error"
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

  // Paso 3: pantalla intermedia "Compra encontrada" — código correcto y una
  // única compra. Sus tres acciones (ver/reenviar/descargar) reutilizan
  // infraestructura ya existente, cada una con su propio estado de carga.
  const [foundSale, setFoundSale] = useState(null);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [resendConfirmationMessage, setResendConfirmationMessage] = useState("");
  const [resendConfirmationError, setResendConfirmationError] = useState("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState("");

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
      const { sales, maskedEmail: verifiedMaskedEmail } = await verifySaleRecoveryCode({
        email: email.trim(),
        buyerDocument: normalizedDocument,
        code: code.trim(),
      });
      setMaskedEmail(verifiedMaskedEmail);
      if (sales.length === 0) {
        setStatus("no-matches");
      } else if (sales.length === 1) {
        setFoundSale(sales[0]);
        setStatus("found");
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

  // Acción "Reenviar al correo" de "Compra encontrada" — reutiliza
  // resendSaleEmail tal cual (mismo endpoint que ya usa SuccessStep.jsx):
  // nunca genera tickets ni QR nuevos, sólo reintenta el envío del email de
  // confirmación ya existente.
  async function handleResendConfirmation() {
    if (!foundSale) return;
    setResendingConfirmation(true);
    setResendConfirmationError("");
    setResendConfirmationMessage("");
    try {
      await resendSaleEmail(foundSale.recoveryToken);
      setResendConfirmationMessage("Las entradas fueron enviadas nuevamente.");
    } catch (err) {
      setResendConfirmationError(err.message || "No pudimos reenviar el correo.");
    } finally {
      setResendingConfirmation(false);
    }
  }

  // Acción "Descargar PDF" — trae el mismo PDF completo que ya se adjunta
  // al email de confirmación (ver getSalePdfByTokenService) como Blob y
  // dispara la descarga en el navegador, sin mostrar los QR en pantalla.
  async function handleDownloadPdf() {
    if (!foundSale) return;
    setDownloadingPdf(true);
    setDownloadError("");
    try {
      const { blob, filename } = await downloadSalePdf(foundSale.recoveryToken);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.message || "No pudimos descargar el PDF.");
    } finally {
      setDownloadingPdf(false);
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
    setFoundSale(null);
    setResendConfirmationMessage("");
    setResendConfirmationError("");
    setDownloadError("");
  }

  // Desde el picker de "Encontramos N compras": elegir una fila también
  // pasa por "Compra encontrada" (mismo criterio que el caso de una sola
  // coincidencia) en vez de navegar directo — una sola pantalla intermedia,
  // sin un segundo camino paralelo hacia PurchaseWizard.
  function handleSelectMatch(sale) {
    setFoundSale(sale);
    setStatus("found");
  }

  if (status === "requesting") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Buscando tu compra...</p>
      </div>
    );
  }

  if (status === "found" && foundSale) {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            <h1 className="text-lg font-bold text-white">Compra encontrada</h1>

            <div className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left">
              <p className="text-sm font-semibold text-white">{foundSale.eventTitle}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                {formatFunctionDate(foundSale.functionDate)}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {foundSale.venue}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                {foundSale.ticketCount} {foundSale.ticketCount === 1 ? "entrada" : "entradas"}
              </p>
              {foundSale.buyerFirstName && <p className="mt-1.5 text-xs text-slate-400">Comprador: {foundSale.buyerFirstName}</p>}
              <p className="text-xs text-slate-400">Correo: {maskedEmail}</p>
            </div>

            <div className="mt-1 flex w-full flex-col gap-2">
              <Button
                onClick={() => navigate(`/comprar?saleToken=${encodeURIComponent(foundSale.recoveryToken)}`)}
                className="w-full justify-center"
              >
                Ver mis entradas
              </Button>

              <Button
                variant="secondary"
                onClick={handleResendConfirmation}
                loading={resendingConfirmation}
                loadingText="Enviando..."
                className="w-full justify-center gap-1.5"
              >
                <Mail className="h-4 w-4" />
                Reenviar al correo
              </Button>
              {resendConfirmationMessage && <p className="text-xs text-emerald-400">{resendConfirmationMessage}</p>}
              {resendConfirmationError && <p className="text-xs text-rose-400">{resendConfirmationError}</p>}

              <Button
                variant="secondary"
                onClick={handleDownloadPdf}
                loading={downloadingPdf}
                loadingText="Descargando..."
                className="w-full justify-center gap-1.5"
              >
                <Download className="h-4 w-4" />
                Descargar PDF
              </Button>
              {downloadError && <p className="text-xs text-rose-400">{downloadError}</p>}
            </div>

            <button
              type="button"
              onClick={handleTryAgain}
              className="mt-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
            >
              Buscar otra compra
            </button>
          </div>
        </Card>
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
                <Button size="sm" className="shrink-0" onClick={() => handleSelectMatch(sale)}>
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
          <h1 className="text-lg font-bold text-white">Reenviar mis entradas</h1>
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

          <BackLink onBack={onBack} />
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// "Pagué pero no recibí mis entradas" — NUEVO. Dos pasos, igual que el
// flujo de arriba: paso 1 (email+DNI+paymentId) nunca revela nada; recién
// después de un código OTP correcto se consulta/reconcilia/confirma/reenvía
// la compra (ver mercadoPagoBuyerRecovery.service.js en el backend). El
// paymentId sólo vive en el estado de ESTE componente — nunca se manda en
// el paso 1, nunca se persiste en el backend entre pasos.
// ============================================================================
function PaymentRecoveryFlow({ onBack }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [buyerDocument, setBuyerDocument] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [documentTouched, setDocumentTouched] = useState(false);
  const [paymentIdTouched, setPaymentIdTouched] = useState(false);

  // "form" | "requesting" | "code" | "matched" | "pending-review" | "no-match" | "error"
  const [status, setStatus] = useState("form");
  const [errorMessage, setErrorMessage] = useState("");

  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [recoveryToken, setRecoveryToken] = useState(null);

  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  const normalizedDocument = normalizeDocument(buyerDocument);
  const isEmailValid = EMAIL_REGEX.test(email.trim());
  const isDocumentValid = DOCUMENT_REGEX.test(normalizedDocument);
  const isPaymentIdValid = paymentId.trim().length > 0;
  const isValid = isEmailValid && isDocumentValid && isPaymentIdValid;
  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  async function handleSearch() {
    if (!isValid) return;
    setStatus("requesting");
    setErrorMessage("");
    try {
      // El paymentId NUNCA viaja acá — sólo email+DNI. Queda en el estado de
      // este componente hasta el paso de verificación.
      const result = await requestPaymentRecoveryCode({ email: email.trim(), buyerDocument: normalizedDocument });
      setMaskedEmail(result);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      setVerifyError("");
      setStatus("code");
    } catch (err) {
      setErrorMessage(err.message || "No pudimos procesar la solicitud. Probá de nuevo en unos minutos.");
      setStatus("error");
    }
  }

  async function handleVerify() {
    if (code.trim().length !== 6) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const result = await verifyPaymentRecoveryCode({
        email: email.trim(),
        buyerDocument: normalizedDocument,
        code: code.trim(),
        paymentId: paymentId.trim(),
      });
      if (result.matched === true) {
        setRecoveryToken(result.recoveryToken);
        setStatus("matched");
      } else if (result.matched === "pending_review") {
        setStatus("pending-review");
      } else {
        setStatus("no-match");
      }
    } catch (err) {
      // Código incorrecto/vencido/demasiados intentos, o una falla real de
      // Mercado Pago/infraestructura — el mensaje ya viene genérico y seguro
      // desde el backend (ErrorCatalog), nunca se interpreta acá cuál fue.
      setVerifyError(err.message || "No pudimos verificar el código.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResendError("");
    try {
      const result = await resendPaymentRecoveryCode({ email: email.trim(), buyerDocument: normalizedDocument });
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
    setCode("");
    setVerifyError("");
    setResendError("");
    setResendCooldownUntil(0);
    setRecoveryToken(null);
  }

  if (status === "requesting") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Procesando tu solicitud...</p>
      </div>
    );
  }

  if (status === "matched") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            <h1 className="text-lg font-bold text-white">¡Encontramos tu pago!</h1>
            <p className="text-sm text-slate-400">Confirmamos tu compra y te enviamos las entradas por correo.</p>
            <Button
              onClick={() => navigate(`/comprar?saleToken=${encodeURIComponent(recoveryToken)}`)}
              className="mt-2 w-full justify-center"
            >
              Ver mis entradas
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "pending-review") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Clock3 className="h-9 w-9 text-amber-400" />
            <h1 className="text-lg font-bold text-white">Tu pago está en revisión</h1>
            <p className="text-sm text-slate-400">
              Confirmamos tu pago, pero necesitamos revisarlo manualmente antes de emitir tus entradas. Nuestro equipo
              se va a contactar con vos.
            </p>
            <Button variant="secondary" onClick={onBack} className="mt-2 w-full justify-center">
              Volver al inicio
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "no-match") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <h1 className="text-lg font-bold text-white">No pudimos verificar esos datos.</h1>
            <p className="text-sm text-slate-400">
              Revisá que el email, el DNI y el número de operación de Mercado Pago sean exactamente los que usaste al
              pagar.
            </p>
            <Button onClick={handleTryAgain} className="mt-2 w-full justify-center">
              Intentar de nuevo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "code") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Search className="h-9 w-9 text-violet-400" />
            <h1 className="text-lg font-bold text-white">Verificá tu identidad</h1>
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
              Usar otros datos
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
      <Card>
        <div className="flex flex-col gap-1 pb-4 text-center">
          <h1 className="text-lg font-bold text-white">Pagué pero no recibí mis entradas</h1>
          <p className="text-sm text-slate-400">Ingresá el email, el DNI y el número de operación de Mercado Pago</p>
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
          <Field label="Número de operación o pago de Mercado Pago" required>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={inputClass}
              value={paymentId}
              onChange={(e) => {
                setPaymentId(e.target.value);
                if (e.target.value) setPaymentIdTouched(true);
              }}
              onBlur={() => setPaymentIdTouched(true)}
              placeholder="Ej: 123456789"
            />
            {paymentIdTouched && !isPaymentIdValid && (
              <p className="text-xs text-rose-400">Ingresá el número de operación o pago de Mercado Pago.</p>
            )}
          </Field>

          {status === "error" && <p className="text-xs text-rose-400">{errorMessage}</p>}

          <Button disabled={!isValid} onClick={handleSearch} className="mt-1 w-full justify-center gap-1.5">
            <Receipt className="h-4 w-4" />
            Verificar mi pago
          </Button>

          <BackLink onBack={onBack} />
        </div>
      </Card>
    </div>
  );
}
