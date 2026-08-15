import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { MessageCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import {
  getWhatsappNumberStatus,
  requestWhatsappNumberChange,
  verifyWhatsappNumberChange,
  resendWhatsappNumberChangeCode,
  cancelWhatsappNumberChange,
} from "../../lib/organizationWhatsappApi.js";

const RESEND_COOLDOWN_MS = 60 * 1000;

// Formato de lectura ("299 4514062") a partir del waId completo que ya
// devuelve el backend (549XXXXXXXXXX) — puramente cosmético, nunca se
// vuelve a mandar este valor formateado a ningún endpoint.
function formatWaIdForDisplay(waId) {
  if (!waId || !waId.startsWith("549") || waId.length !== 13) return waId ?? "";
  const significant = waId.slice(3);
  return `${significant.slice(0, 3)} ${significant.slice(3)}`;
}

// Tarjeta autocontenida para el panel de Configuración del organizador —
// SEPARADA de Organization.phone (el teléfono público/de contacto, que
// sigue viviendo en OrganizerSettings.jsx tal cual): esto es el número
// AUTORIZADO para administrar la organización por WhatsApp
// (WhatsappOrganizerLink.waId). `organizationId` lo pasa el caller (ya
// resuelto por GET /api/organizations/me) — el backend igual revalida
// pertenencia real en cada request.
export default function WhatsappNumberChangeCard({ organizationId, organizationName }) {
  const { getToken } = useAuth();

  // "loading" | "idle" | "request" | "code" | "success"
  const [phase, setPhase] = useState("loading");
  const [waId, setWaId] = useState(null);
  const [statusError, setStatusError] = useState("");

  const [phone, setPhone] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (resendCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  async function loadStatus() {
    if (!organizationId) return;
    try {
      const token = await getToken();
      const status = await getWhatsappNumberStatus(token, organizationId);
      setWaId(status.waId);
      setPhase("idle");
    } catch (err) {
      setStatusError(err.message || "No pudimos consultar tu número autorizado.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000));

  function resetToIdle() {
    setPhase("idle");
    setPhone("");
    setCode("");
    setRequestError("");
    setVerifyError("");
    setResendError("");
    setResendCooldownUntil(0);
  }

  async function handleSendCode() {
    if (!phone.trim()) return;
    setRequesting(true);
    setRequestError("");
    try {
      const token = await getToken();
      await requestWhatsappNumberChange(token, organizationId, phone.trim());
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      setVerifyError("");
      setPhase("code");
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
      const token = await getToken();
      await verifyWhatsappNumberChange(token, organizationId, code.trim());
      setPhase("success");
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
      const token = await getToken();
      await resendWhatsappNumberChangeCode(token, organizationId);
      setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setResendError(err.message || "No pudimos reenviar el código.");
    } finally {
      setResending(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const token = await getToken();
      await cancelWhatsappNumberChange(token, organizationId);
    } catch {
      // Cancelar es best-effort del lado de la UI: si la llamada falla
      // igual volvemos a la pantalla inicial, el challenge vence solo.
    } finally {
      setCancelling(false);
      resetToIdle();
    }
  }

  async function handleDone() {
    resetToIdle();
    await loadStatus();
  }

  if (phase === "success") {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
          <h3 className="text-lg font-bold text-white">Nuevo número registrado con éxito</h3>
          <p className="text-sm text-slate-400">
            Tu nuevo número quedó vinculado a <span className="font-medium text-slate-200">{organizationName}</span>.
          </p>
          <p className="text-sm text-slate-400">A partir de ahora podés gestionar esta organización desde tu nuevo WhatsApp.</p>
          <p className="text-xs text-slate-500">Te enviamos un mensaje de bienvenida.</p>
          <Button onClick={handleDone} className="mt-2 w-full max-w-xs justify-center">
            Listo
          </Button>
        </div>
      </Card>
    );
  }

  if (phase === "code") {
    return (
      <Card title="Verificar nuevo número">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">
            Te enviamos un código de 6 dígitos a <span className="font-medium text-slate-200">{phone.trim()}</span>. Vence en 10 minutos.
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

          <Button onClick={handleVerify} loading={verifying} loadingText="Verificando..." disabled={code.trim().length !== 6} className="justify-center">
            Verificar número
          </Button>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || cooldownRemaining > 0}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} />
              {cooldownRemaining > 0 ? `Reenviar código (${cooldownRemaining}s)` : "Reenviar código"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
          </div>
          {resendError && <p className="text-xs text-rose-400">{resendError}</p>}
        </div>
      </Card>
    );
  }

  if (phase === "request") {
    return (
      <Card title="Cambiar número de WhatsApp">
        <div className="flex flex-col gap-3">
          <Field label="Nuevo número">
            <input
              type="tel"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="299 451-4062"
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
            />
          </Field>

          {requestError && <p className="text-sm text-rose-400">{requestError}</p>}

          <div className="flex gap-2">
            <Button onClick={handleSendCode} loading={requesting} loadingText="Enviando..." disabled={!phone.trim()} className="flex-1 justify-center">
              Enviar código
            </Button>
            <Button variant="secondary" onClick={resetToIdle} disabled={requesting}>
              Cancelar
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // phase === "idle" | "loading"
  return (
    <Card title="WhatsApp autorizado">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
            <MessageCircle className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Número de WhatsApp autorizado</p>
            {phase === "loading" ? (
              <div className="mt-1 h-4 w-32 animate-pulse rounded bg-white/10" />
            ) : waId ? (
              <p className="text-sm font-medium text-white">{formatWaIdForDisplay(waId)}</p>
            ) : (
              <p className="text-sm text-slate-500">Todavía no vinculaste un WhatsApp.</p>
            )}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setPhase("request")} disabled={phase === "loading"}>
          {waId ? "Cambiar número" : "Vincular número"}
        </Button>
      </div>
      {statusError && <p className="mt-2 text-xs text-rose-400">{statusError}</p>}
    </Card>
  );
}
