import { useEffect, useState } from "react";
import { Search, CalendarDays, MapPin, RefreshCw, CheckCircle2, Ticket, MessageCircle, Mail } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import {
  requestWithdrawalOtp,
  resendWithdrawalOtp,
  verifyWithdrawalOtp,
  createWithdrawalRequest,
  dismissWithdrawalRequest,
} from "../../lib/withdrawalRequestApi.js";

// Cierre del ciclo — mismo bloque "Contactar al organizador" que ya usaba
// la pantalla de "Solicitud registrada" (submitResult.contact), extraído
// para reusarlo tal cual en "Volver a contactar" sobre una compra con
// solicitud YA existente — nunca una segunda implementación de la regla de
// contacto (eso vive únicamente en buildOrganizationContact, backend).
function ContactActions({ contact, size = "md" }) {
  if (contact?.whatsappUrl) {
    return (
      <a href={contact.whatsappUrl} target="_blank" rel="noreferrer" className="w-full">
        <Button size={size} className="w-full justify-center gap-1.5">
          <MessageCircle className="h-4 w-4" />
          Contactar por WhatsApp
        </Button>
      </a>
    );
  }
  if (contact?.email) {
    return (
      <a href={`mailto:${contact.email}`} className="w-full">
        <Button size={size} variant="secondary" className="w-full justify-center gap-1.5">
          <Mail className="h-4 w-4" />
          {contact.email}
        </Button>
      </a>
    );
  }
  return <p className="text-xs text-slate-500">El organizador no tiene un contacto público disponible en este momento.</p>;
}

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const DOCUMENT_REGEX = /^\d{7,10}$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

const REASON_OPTIONS = [
  { value: "ARREPENTIMIENTO", label: "Me arrepentí de la compra" },
  { value: "ERROR_COMPRA", label: "Compré por error" },
  { value: "CAMBIO_EVENTO", label: "Cambio/cancelación relacionada con el evento" },
  { value: "PROBLEMA_ENTRADAS", label: "Problema con las entradas" },
  { value: "OTRO", label: "Otro" },
];

const REQUEST_STATUS_LABEL = {
  REQUESTED: "Ya registramos una solicitud para esta compra — está pendiente de contacto.",
  CONTACTED: "Ya registramos una solicitud para esta compra — el organizador ya fue notificado.",
};

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

// Botón de arrepentimiento — pública, sin sesión, sin cuenta de comprador
// (nunca Clerk acá). Mismo criterio de privacidad que RecoverPurchase.jsx:
// email+DNI sólo localizan, NUNCA se muestra evento/cantidad/estado antes
// de un código de 6 dígitos verificado (ver withdrawalRequestVerification.service.js
// en el backend). Después de elegir una compra y un motivo, la solicitud
// se registra — nunca es un reembolso automático, sólo un pedido de
// contacto (ver el informe de entrega).
export default function WithdrawalRequest() {
  const [email, setEmail] = useState("");
  const [buyerDocument, setBuyerDocument] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [documentTouched, setDocumentTouched] = useState(false);

  // "form" | "requesting" | "code" | "select" | "no-matches" | "reason" | "submitting" | "submitted" | "error"
  const [status, setStatus] = useState("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [sales, setSales] = useState([]);

  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [selectedSale, setSelectedSale] = useState(null);
  const [reason, setReason] = useState("ARREPENTIMIENTO");
  const [reasonNote, setReasonNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState(null);

  // Cierre del ciclo — "Volver a contactar" / "Descartar solicitud" sobre
  // una compra que YA tiene una solicitud activa (pantalla "select").
  // Claves por saleToken (única forma estable de identificar cada fila de
  // `sales` acá) — nunca por índice, que cambiaría si la lista se
  // reordenara.
  const [contactOpenToken, setContactOpenToken] = useState(null);
  const [confirmDismissSale, setConfirmDismissSale] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState("");

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
      const result = await requestWithdrawalOtp({ email: email.trim(), buyerDocument: normalizedDocument });
      setMaskedEmail(result);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      setVerifyError("");
      setStatus("code");
    } catch (err) {
      setErrorMessage(err.message || "No pudimos procesar tu pedido. Probá de nuevo en unos minutos.");
      setStatus("error");
    }
  }

  async function handleVerify() {
    if (code.trim().length !== 6) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const { sales: foundSales, maskedEmail: verifiedMaskedEmail } = await verifyWithdrawalOtp({
        email: email.trim(),
        buyerDocument: normalizedDocument,
        code: code.trim(),
      });
      setMaskedEmail(verifiedMaskedEmail);
      setSales(foundSales);
      setStatus(foundSales.length === 0 ? "no-matches" : "select");
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
      const result = await resendWithdrawalOtp({ email: email.trim(), buyerDocument: normalizedDocument });
      setMaskedEmail(result);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setResendError(err.message || "No pudimos reenviar el código.");
    } finally {
      setResending(false);
    }
  }

  // Cierre del ciclo — descarta la solicitud ACTIVA de esta compra
  // puntual. Nunca toca Ticket/QR/disponibilidad (eso vive exclusivamente
  // en el backend, ver dismissWithdrawalRequestService) — acá sólo se
  // actualiza la fila correspondiente en memoria para que la tarjeta
  // vuelva a mostrar "Solicitar por esta compra", sin tener que reverificar
  // el OTP de nuevo.
  async function handleDismiss(sale) {
    setDismissing(true);
    setDismissError("");
    try {
      await dismissWithdrawalRequest(sale.saleToken);
      setSales((prev) =>
        prev.map((s) => (s.saleToken === sale.saleToken ? { ...s, existingRequestStatus: null, withdrawalRequestId: null, contact: null } : s))
      );
      setConfirmDismissSale(null);
      setContactOpenToken((prev) => (prev === sale.saleToken ? null : prev));
    } catch (err) {
      setDismissError(err.message || "No pudimos descartar la solicitud.");
    } finally {
      setDismissing(false);
    }
  }

  function handleSelectSale(sale) {
    setSelectedSale(sale);
    setReason("ARREPENTIMIENTO");
    setReasonNote("");
    setSubmitError("");
    setStatus("reason");
  }

  async function handleSubmitRequest() {
    if (!selectedSale) return;
    setStatus("submitting");
    setSubmitError("");
    try {
      const result = await createWithdrawalRequest(selectedSale.saleToken, { reason, reasonNote: reasonNote.trim() || undefined });
      setSubmitResult(result);
      setStatus("submitted");
    } catch (err) {
      setSubmitError(err.message || "No pudimos registrar tu solicitud.");
      setStatus("reason");
    }
  }

  function handleTryAgain() {
    setStatus("form");
    setErrorMessage("");
    setSales([]);
    setCode("");
    setVerifyError("");
    setResendError("");
    setResendCooldownUntil(0);
    setSelectedSale(null);
    setSubmitResult(null);
    setSubmitError("");
    setContactOpenToken(null);
    setConfirmDismissSale(null);
    setDismissError("");
  }

  if (status === "requesting" || status === "submitting") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">{status === "submitting" ? "Registrando tu solicitud..." : "Procesando..."}</p>
      </div>
    );
  }

  if (status === "submitted" && submitResult) {
    const alreadyExisted = submitResult.alreadyExisted;
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            <h1 className="text-lg font-bold text-white">
              {alreadyExisted ? "Ya teníamos una solicitud registrada" : "Solicitud registrada"}
            </h1>
            <p className="text-sm text-slate-400">
              {alreadyExisted
                ? "Ya existía una solicitud activa para esta compra — no se creó una nueva."
                : "Registramos tu solicitud relacionada con tu compra."}
            </p>
            <div className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left text-xs text-slate-400">
              <p className="text-sm font-semibold text-white">{submitResult.eventTitle}</p>
              <p className="mt-1">Estado: {submitResult.status === "CONTACTED" ? "Organizador notificado" : "Registrada"}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Esto registra tu pedido — no es una confirmación de reembolso ni cancela tu compra automáticamente.
            </p>

            <div className="mt-2 flex w-full flex-col gap-2">
              <p className="text-sm font-semibold text-white">Contactar al organizador</p>
              <ContactActions contact={submitResult.contact} />
            </div>

            <button type="button" onClick={handleTryAgain} className="mt-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300">
              Volver al inicio
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "reason" && selectedSale) {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col gap-4 py-2">
            <div className="text-center">
              <h1 className="text-lg font-bold text-white">Contanos el motivo</h1>
              <p className="mt-1 text-sm text-slate-400">{selectedSale.eventTitle}</p>
            </div>

            <div className="flex flex-col gap-2">
              {REASON_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200 has-[:checked]:border-violet-500/60 has-[:checked]:bg-violet-500/10"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="accent-violet-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            <Field label="Comentario (opcional)">
              <textarea
                className={`${inputClass} min-h-[80px] resize-none`}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value.slice(0, 500))}
                maxLength={500}
                placeholder="Contale al organizador más detalles si querés"
              />
            </Field>

            {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

            <Button onClick={handleSubmitRequest} className="w-full justify-center">
              Registrar solicitud
            </Button>
            <button type="button" onClick={() => setStatus("select")} className="text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300">
              Elegir otra compra
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "select") {
    return (
      <div className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-10">
        <Card>
          <div className="flex flex-col gap-1 pb-4 text-center">
            <h1 className="text-lg font-bold text-white">Elegí la compra</h1>
            <p className="text-sm text-slate-400">Seleccioná la compra sobre la que querés hacer tu solicitud</p>
          </div>
          <div className="flex flex-col gap-3">
            {sales.map((sale) => (
              <div key={sale.saleToken} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
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
                  <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <Ticket className="h-3.5 w-3.5 shrink-0" />
                    {sale.ticketCount} {sale.ticketCount === 1 ? "entrada" : "entradas"}
                  </p>
                </div>
                {sale.existingRequestStatus ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-amber-300">{REQUEST_STATUS_LABEL[sale.existingRequestStatus] ?? "Ya existe una solicitud para esta compra."}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1 justify-center"
                        onClick={() => setContactOpenToken((prev) => (prev === sale.saleToken ? null : sale.saleToken))}
                      >
                        Volver a contactar
                      </Button>
                      <Button size="sm" variant="secondary" className="flex-1 justify-center text-rose-400" onClick={() => setConfirmDismissSale(sale)}>
                        Descartar solicitud
                      </Button>
                    </div>
                    {contactOpenToken === sale.saleToken && (
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                        <ContactActions contact={sale.contact} size="sm" />
                      </div>
                    )}
                    {dismissError && confirmDismissSale?.saleToken === sale.saleToken && <p className="text-xs text-rose-400">{dismissError}</p>}
                  </div>
                ) : (
                  <Button size="sm" onClick={() => handleSelectSale(sale)} className="w-full justify-center">
                    Solicitar por esta compra
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={handleTryAgain} className="mt-5 w-full justify-center">
            Buscar de nuevo
          </Button>
        </Card>

        {confirmDismissSale && (
          <ConfirmDialog
            title="¿Descartar esta solicitud?"
            description="Tu entrada seguirá vigente. Esta acción solamente cancela la solicitud de devolución — vas a poder iniciar una nueva más adelante si lo necesitás."
            confirmLabel="Descartar solicitud"
            danger
            loading={dismissing}
            onConfirm={() => handleDismiss(confirmDismissSale)}
            onClose={() => setConfirmDismissSale(null)}
          />
        )}
      </div>
    );
  }

  if (status === "code") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Search className="h-9 w-9 text-violet-400" />
            <h1 className="text-lg font-bold text-white">Si encontramos compras asociadas a esos datos, te enviamos un código.</h1>
            <p className="text-sm text-slate-400">
              Revisá el correo: <span className="font-medium text-slate-200">{maskedEmail}</span>.
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

            <Button onClick={handleVerify} loading={verifying} loadingText="Verificando..." disabled={code.trim().length !== 6} className="mt-1 w-full justify-center">
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

            <button type="button" onClick={handleTryAgain} className="mt-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300">
              Usar otro correo o DNI
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (status === "no-matches") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <h1 className="text-lg font-bold text-white">No encontramos compras disponibles con esos datos.</h1>
            <p className="text-sm text-slate-400">Revisá que el email y el DNI sean exactamente los que usaste al comprar.</p>
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
          <h1 className="text-lg font-bold text-white">Botón de arrepentimiento</h1>
          <p className="text-sm text-slate-400">Ingresá el email y el DNI que usaste al comprar para gestionar tu compra</p>
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
            {documentTouched && !isDocumentValid && <p className="text-xs text-rose-400">El DNI tiene que tener entre 7 y 10 números.</p>}
          </Field>

          {status === "error" && <p className="text-xs text-rose-400">{errorMessage}</p>}

          <Button disabled={!isValid} onClick={handleSearch} className="mt-1 w-full justify-center gap-1.5">
            <Search className="h-4 w-4" />
            Enviar código de verificación a mi correo
          </Button>
        </div>
      </Card>
    </div>
  );
}
