import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { MessageCircle, CheckCircle2, Clock, RefreshCw, Trash2 } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import {
  getOrganizationPhoneStatus,
  requestOrganizationPhoneVerification,
  verifyOrganizationPhoneChangeOtp,
  resendOrganizationPhoneChangeOtp,
  resendOrganizationPhoneWhatsapp,
  cancelOrganizationPhoneChange,
  deleteOrganizationPhone,
} from "../../lib/organizationPhoneVerificationApi.js";
import { useToast } from "../../context/ToastContext.jsx";

const RESEND_COOLDOWN_MS = 60 * 1000;

// Verificación de teléfono/WhatsApp de Organización — SEPARADA de
// WhatsappNumberChangeCard.jsx (ese es el número AUTORIZADO para
// administrar por el bot; esto es Organization.phone, el contacto
// público). No muestra complejidad técnica: nunca habla de "webhook",
// "HMAC", "hash" ni "token" — sólo estados simples (Verificado / Pendiente).
//
// Flujo invertido: EL ORGANIZADOR inicia la conversación de WhatsApp hacia
// PaseCultural — PaseCultural nunca manda un mensaje primero. `deepLink`
// (URL wa.me con "CONFIRMAR <token>" prearmado) sólo existe EN MEMORIA acá:
// el backend nunca la vuelve a mostrar en el GET de estado (no guarda el
// token en texto plano) — si se pierde (recarga de página), "Abrir WhatsApp
// nuevamente" pide una nueva.
export default function OrganizationPhoneVerificationCard({ organizationId }) {
  const { getToken } = useAuth();
  const toast = useToast();

  // "loading" | "idle" | "request" | "email-otp" | "whatsapp-waiting"
  const [phase, setPhase] = useState("loading");
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");

  const [phone, setPhone] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [deepLink, setDeepLink] = useState(null);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // true mientras se muestra el ConfirmDialog para eliminar un WhatsApp YA
  // VERIFICADO — eliminar uno no verificado nunca necesita confirmación
  // (mismo criterio que "Cancelar cambio", que tampoco la pide).
  const [confirmDeleteVerified, setConfirmDeleteVerified] = useState(false);

  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  async function loadStatus() {
    if (!organizationId) return;
    try {
      const token = await getToken();
      const result = await getOrganizationPhoneStatus(token, organizationId);
      setStatus(result);
      setStatusError("");
      if (result.pendingPhone) setPhase("whatsapp-waiting");
      else if (result.emailOtpPending) setPhase("email-otp");
      else setPhase("idle");
    } catch (err) {
      setStatusError(err.message || "No pudimos consultar el estado de tu WhatsApp.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  function resetToIdle() {
    setPhone("");
    setCode("");
    setRequestError("");
    setVerifyError("");
    setReopenError("");
    setDeleteError("");
    setConfirmDeleteVerified(false);
    setDeepLink(null);
    setResendCooldownUntil(0);
    loadStatus();
  }

  async function handleRequest() {
    if (!phone.trim()) return;
    setRequesting(true);
    setRequestError("");
    try {
      const token = await getToken();
      const result = await requestOrganizationPhoneVerification(token, organizationId, phone.trim());
      setCode("");
      setVerifyError("");
      if (result.step === "EMAIL_OTP_REQUIRED") {
        setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
        setPhase("email-otp");
      } else {
        setDeepLink(result.deepLink);
        setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
        setPhase("whatsapp-waiting");
      }
      await loadStatus();
    } catch (err) {
      setRequestError(err.message || "No pudimos iniciar la verificación.");
    } finally {
      setRequesting(false);
    }
  }

  async function handleVerifyOtp() {
    if (code.trim().length !== 6) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const token = await getToken();
      const result = await verifyOrganizationPhoneChangeOtp(token, organizationId, code.trim());
      setDeepLink(result.deepLink);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setPhase("whatsapp-waiting");
      toast.success("Código verificado. Ahora abrí WhatsApp para confirmar el número nuevo.");
      await loadStatus();
    } catch (err) {
      setVerifyError(err.message || "No pudimos verificar el código.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResendEmailOtp() {
    setReopening(true);
    setReopenError("");
    try {
      const token = await getToken();
      await resendOrganizationPhoneChangeOtp(token, organizationId);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setReopenError(err.message || "No pudimos reenviar.");
    } finally {
      setReopening(false);
    }
  }

  // Pide un deep link nuevo al backend (sujeto al cooldown anti-abuso) y lo
  // abre en una pestaña — la pestaña se abre ANTES del await (mismo truco
  // que cualquier flujo con un paso async en el medio) para que los
  // bloqueadores de pop-ups no lo corten: el user gesture del click ya la
  // habilitó.
  async function reissueAndOpenWhatsapp() {
    setReopening(true);
    setReopenError("");
    const newTab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const token = await getToken();
      const result = await resendOrganizationPhoneWhatsapp(token, organizationId);
      setDeepLink(result.deepLink);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      if (newTab) newTab.location.href = result.deepLink;
    } catch (err) {
      if (newTab) newTab.close();
      setReopenError(err.message || "No pudimos abrir WhatsApp.");
    } finally {
      setReopening(false);
    }
  }

  // Botón principal "Abrir WhatsApp" — si ya tenemos el deep link en
  // memoria (recién emitido por request/verify), lo reabre directo, sin
  // llamar al backend. Si se perdió (recarga de página), pide uno nuevo.
  function handleOpenWhatsapp() {
    if (deepLink) {
      window.open(deepLink, "_blank", "noopener,noreferrer");
      return;
    }
    reissueAndOpenWhatsapp();
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const token = await getToken();
      await cancelOrganizationPhoneChange(token, organizationId);
    } catch {
      // Cancelar es best-effort del lado de la UI: el intento vence solo igual.
    } finally {
      setCancelling(false);
      resetToIdle();
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  }

  // Sirve tanto "Eliminar número" (no verificado, llamado directo) como
  // "Eliminar WhatsApp de contacto" (verificado, llamado recién después de
  // confirmar en el ConfirmDialog, ver más abajo) — misma mutación.
  async function handleDeletePhone() {
    setDeleting(true);
    setDeleteError("");
    try {
      const token = await getToken();
      await deleteOrganizationPhone(token, organizationId);
      setConfirmDeleteVerified(false);
      toast.success("Eliminamos tu WhatsApp de contacto.");
      resetToIdle();
    } catch (err) {
      setDeleteError(err.message || "No pudimos eliminar el número.");
    } finally {
      setDeleting(false);
    }
  }

  if (phase === "loading") {
    return (
      <Card title="WhatsApp de contacto">
        <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
      </Card>
    );
  }

  if (phase === "email-otp") {
    return (
      <Card title="Cambiar WhatsApp de contacto">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">
            Te mandamos un código de 6 dígitos a tu email para autorizar el cambio. Vence en 10 minutos. Tu WhatsApp actual sigue activo hasta que confirmes el nuevo número.
          </p>

          <Field label="Código">
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

          {verifyError && <p className="text-sm text-rose-400">{verifyError}</p>}

          <Button onClick={handleVerifyOtp} loading={verifying} loadingText="Verificando..." disabled={code.trim().length !== 6} className="justify-center">
            Verificar código
          </Button>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResendEmailOtp}
              disabled={reopening || cooldownRemaining > 0}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <RefreshCw className={`h-3 w-3 ${reopening ? "animate-spin" : ""}`} />
              {cooldownRemaining > 0 ? `Reenviar código (${cooldownRemaining}s)` : "Reenviar código"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300 disabled:cursor-not-allowed"
            >
              Cancelar cambio
            </button>
          </div>
          {reopenError && <p className="text-xs text-rose-400">{reopenError}</p>}
        </div>
      </Card>
    );
  }

  if (phase === "whatsapp-waiting") {
    return (
      <Card title="WhatsApp de contacto">
        <div className="flex flex-col gap-3">
          {status?.verifiedAt && (
            <div>
              <p className="text-xs font-medium text-slate-400">WhatsApp actual</p>
              <p className="flex items-center gap-1.5 text-sm font-medium text-white">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {status.phone} — Verificado
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-slate-400">{status?.verifiedAt ? "Nuevo WhatsApp" : "WhatsApp"}</p>
            <p className="flex items-center gap-1.5 text-sm font-medium text-white">
              <Clock className="h-4 w-4 text-amber-400" /> {status?.pendingPhone} — Pendiente de confirmación
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Abrí WhatsApp desde ese mismo teléfono y mandá el mensaje que ya te dejamos escrito — apenas lo recibamos, queda verificado.
            </p>
          </div>

          <Button onClick={handleOpenWhatsapp} loading={reopening} loadingText="Abriendo..." className="justify-center">
            <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={reissueAndOpenWhatsapp}
              disabled={reopening || cooldownRemaining > 0}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <RefreshCw className={`h-3 w-3 ${reopening ? "animate-spin" : ""}`} />
              {cooldownRemaining > 0 ? `Abrir WhatsApp nuevamente (${cooldownRemaining}s)` : "Abrir WhatsApp nuevamente"}
            </button>
            <div className="flex items-center gap-3">
              {/* Nunca junto a un cambio en curso sobre un teléfono YA
                  verificado — ahí sólo "Cancelar cambio" tiene sentido, A
                  debe quedar intacto (ver el informe de entrega). */}
              {!status?.verifiedAt && (
                <button
                  type="button"
                  onClick={handleDeletePhone}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 transition-colors duration-150 hover:text-rose-400 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar número
                </button>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300 disabled:cursor-not-allowed"
              >
                Cancelar cambio
              </button>
            </div>
          </div>
          {reopenError && <p className="text-xs text-rose-400">{reopenError}</p>}
          {deleteError && <p className="text-xs text-rose-400">{deleteError}</p>}

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="self-start text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
          >
            {refreshing ? "Actualizando..." : "Ya confirmé, actualizar estado"}
          </button>
        </div>
      </Card>
    );
  }

  if (phase === "request") {
    return (
      <Card title={status?.verifiedAt ? "Cambiar WhatsApp de contacto" : "Verificar WhatsApp de contacto"}>
        <div className="flex flex-col gap-3">
          <Field label={status?.verifiedAt ? "Nuevo número" : "Número"}>
            <input
              type="tel"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="351 412-3456"
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleRequest()}
            />
          </Field>

          {requestError && <p className="text-sm text-rose-400">{requestError}</p>}

          <div className="flex gap-2">
            <Button onClick={handleRequest} loading={requesting} loadingText="Generando enlace..." disabled={!phone.trim()} className="flex-1 justify-center">
              {status?.verifiedAt ? "Enviar código de autorización" : "Verificar WhatsApp"}
            </Button>
            <Button variant="secondary" onClick={() => setPhase("idle")} disabled={requesting}>
              Cancelar
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // phase === "idle"
  return (
    <Card title="WhatsApp de contacto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
            <MessageCircle className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            {status?.phone ? (
              <>
                <p className="text-sm font-medium text-white">{status.phone}</p>
                {status.verifiedAt ? (
                  <p className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Verificado
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-amber-400">
                    <Clock className="h-3.5 w-3.5" /> Pendiente de verificación
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">Todavía no cargaste un WhatsApp de contacto.</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Este es el WhatsApp público que ven tus compradores — distinto del número autorizado para administrar por chat (más abajo).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // Sección "organizaciones existentes" — verificar un número
              // legacy YA cargado no debe obligar a retipearlo.
              setPhone(!status?.verifiedAt && status?.phone ? status.phone : "");
              setPhase("request");
            }}
          >
            {status?.verifiedAt ? "Cambiar WhatsApp de contacto" : status?.phone ? "Verificar WhatsApp" : "Agregar WhatsApp"}
          </Button>
          {status?.phone && (
            <button
              type="button"
              title={status.verifiedAt ? "Eliminar WhatsApp de contacto" : "Eliminar número"}
              aria-label={status.verifiedAt ? "Eliminar WhatsApp de contacto" : "Eliminar número"}
              onClick={() => (status.verifiedAt ? setConfirmDeleteVerified(true) : handleDeletePhone())}
              disabled={deleting}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-400 transition-colors duration-150 hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {statusError && <p className="mt-2 text-xs text-rose-400">{statusError}</p>}
      {deleteError && <p className="mt-2 text-xs text-rose-400">{deleteError}</p>}

      {confirmDeleteVerified && (
        <ConfirmDialog
          title="Eliminar WhatsApp de contacto"
          description="¿Querés eliminar este WhatsApp de contacto? Los compradores ya no podrán contactarte por WhatsApp desde PaseCultural."
          confirmLabel="Eliminar"
          danger
          loading={deleting}
          onConfirm={handleDeletePhone}
          onClose={() => setConfirmDeleteVerified(false)}
        />
      )}
    </Card>
  );
}
