import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, Landmark, MessageCircle } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";

function FieldSkeleton({ className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
      <div className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
    </div>
  );
}

// Fase 2F — sección "Vincular WhatsApp". Estado propio (no vive en el
// formulario de la organización de arriba): la vinculación no se guarda
// con "Guardar cambios", se confirma sola apenas el código es válido. El
// backend deriva la organización EXCLUSIVAMENTE de la sesión Clerk — este
// componente nunca manda organizationId/userId/clerkId/waId, sólo el
// código de 6 dígitos que el organizador tipea (ver
// whatsappOrganizerLink.service.js#linkWhatsappOrganizerService).
function WhatsappLinkSection() {
  const { getToken } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(null); // null = cargando
  const [code, setCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const result = await apiFetch("/api/organizations/me/whatsapp-link", { token });
        if (!cancelled) setStatus(result);
      } catch (err) {
        console.error("No se pudo consultar el estado de WhatsApp", err);
        if (!cancelled) setStatus({ linked: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function handleLink(event) {
    event.preventDefault();
    if (!code.trim()) return;

    setLinking(true);
    setError("");

    try {
      const token = await getToken();
      await apiFetch("/api/organizations/me/whatsapp-link", {
        token,
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setStatus({ linked: true, verifiedAt: new Date().toISOString() });
      setCode("");
      toast.success("WhatsApp vinculado correctamente.");
    } catch (err) {
      // err.code viene de ErrorCatalog (ver errorHandler.js) — cada caso
      // esperado tiene su propio texto; cualquier otro cae al mensaje
      // genérico que ya trae err.message.
      const messagesByCode = {
        WHATSAPP_LINK_CODE_INVALID: "El código ingresado es incorrecto.",
        WHATSAPP_LINK_CODE_EXPIRED: "Ese código venció. Volvé a escribirle al bot de WhatsApp para pedir uno nuevo.",
        WHATSAPP_LINK_TOO_MANY_ATTEMPTS: "Superaste el máximo de intentos. Esperá unos minutos y volvé a intentarlo.",
        WHATSAPP_ALREADY_LINKED: "Tu organización ya tiene un WhatsApp vinculado.",
      };
      setError(messagesByCode[err.code] || err.message || "No pudimos vincular el WhatsApp. Probá de nuevo.");
      if (err.code === "WHATSAPP_ALREADY_LINKED") {
        setStatus({ linked: true, verifiedAt: null });
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <Card title="WhatsApp">
      <p className="mb-4 text-xs text-slate-400">
        Vinculá tu WhatsApp para crear y gestionar eventos desde el chat.
      </p>

      {status === null ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/10 p-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/5" />
          <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
        </div>
      ) : status.linked ? (
        <div className="flex items-center gap-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-300">WhatsApp vinculado correctamente.</p>
            <p className="text-xs text-slate-500">Ya podés crear eventos escribiéndole al bot de PaseCultural.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleLink} className="flex flex-col gap-3 sm:max-w-xs">
          <Field label="Código de 6 dígitos">
            <input
              className={inputClass}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError("");
              }}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
            />
          </Field>
          {error && <span className="text-xs text-rose-400">{error}</span>}
          <Button type="submit" loading={linking} loadingText="Vinculando..." disabled={code.trim().length !== 6}>
            <MessageCircle className="h-4 w-4" />
            Vincular WhatsApp
          </Button>
        </form>
      )}
    </Card>
  );
}

const EMPTY_ORG = {
  logo: "",
  name: "",
  cuit: "",
  email: "",
  phone: "",
  province: "",
  city: "",
  website: "",
  instagram: "",
  description: "",
};

export default function OrganizerSettings() {
  const { getToken } = useAuth();
  const toast = useToast();
  const [org, setOrg] = useState(EMPTY_ORG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization } = await apiFetch("/api/organizations/me", { token });
        if (!cancelled && organization) {
          setOrg({
            logo: organization.logo || "",
            name: organization.name || "",
            cuit: organization.cuit || "",
            email: organization.email || "",
            phone: organization.phone || "",
            province: organization.province || "",
            city: organization.city || "",
            website: organization.website || "",
            instagram: organization.instagram || "",
            description: organization.description || "",
          });
        }
      } catch (err) {
        console.error("No se pudo cargar la organización", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  function setOrgField(key, value) {
    setOrg((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");

    try {
      const token = await getToken();
      const { organization } = await apiFetch("/api/organizations/me", {
        token,
        method: "PATCH",
        body: JSON.stringify(org),
      });
      setOrg((prev) => ({ ...prev, logo: organization.logo || "" }));
      setSavedAt(Date.now());
      toast.success("Cambios guardados.");
    } catch (err) {
      setSaveError(err.message || "No pudimos guardar los cambios. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Configuración</h1>
          <p className="text-sm text-slate-400">
            Datos del organizador y de cobro
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-xs text-rose-400">{saveError}</span>}
          {savedAt && !saveError && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="h-4 w-4" />
              Cambios guardados
            </span>
          )}
          <Button type="submit" loading={saving} loadingText="Guardando..." disabled={loading || saving}>
            Guardar cambios
          </Button>
        </div>
      </div>

      <Card title="Datos del organizador">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldSkeleton className="sm:col-span-2 sm:max-w-xs" />
            {Array.from({ length: 7 }).map((_, i) => (
              <FieldSkeleton key={i} />
            ))}
            <FieldSkeleton className="sm:col-span-2" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 sm:max-w-xs">
              <ImageUploader
                label="Logo"
                value={org.logo}
                onChange={(url) => setOrgField("logo", url || "")}
              />
            </div>
            <Field label="Nombre comercial" required>
              <input
                className={inputClass}
                value={org.name}
                onChange={(e) => setOrgField("name", e.target.value)}
              />
            </Field>
            <Field label="CUIT" required>
              <input
                className={inputClass}
                value={org.cuit}
                onChange={(e) => setOrgField("cuit", e.target.value)}
              />
            </Field>
            <Field label="Correo" required>
              <input
                type="email"
                className={inputClass}
                value={org.email}
                onChange={(e) => setOrgField("email", e.target.value)}
              />
            </Field>
            <Field label="Teléfono" required>
              <input
                className={inputClass}
                value={org.phone}
                onChange={(e) => setOrgField("phone", e.target.value)}
              />
            </Field>
            <Field label="Provincia" required>
              <input
                className={inputClass}
                value={org.province}
                onChange={(e) => setOrgField("province", e.target.value)}
              />
            </Field>
            <Field label="Ciudad" required>
              <input
                className={inputClass}
                value={org.city}
                onChange={(e) => setOrgField("city", e.target.value)}
              />
            </Field>
            <Field label="Sitio web">
              <input
                className={inputClass}
                value={org.website}
                onChange={(e) => setOrgField("website", e.target.value)}
              />
            </Field>
            <Field label="Instagram">
              <input
                className={inputClass}
                value={org.instagram}
                onChange={(e) => setOrgField("instagram", e.target.value)}
              />
            </Field>
            <Field label="Descripción" className="sm:col-span-2">
              <textarea
                className={textareaClass}
                value={org.description}
                onChange={(e) => setOrgField("description", e.target.value)}
              />
            </Field>
          </div>
        )}
      </Card>

      <WhatsappLinkSection />

      <Card title="Datos bancarios">
        {/* Todavía no hay integración real de cobro (ni Mercado Pago ni
            CBU/alias persistidos en el backend) — se muestra como
            "Próximamente" en vez de un toggle que no conecta nada de
            verdad y campos que no llegaban a guardarse. */}
        <div className="flex items-center gap-4 rounded-lg border border-dashed border-white/10 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
            <Landmark className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Cobros con Mercado Pago</p>
            <p className="text-xs text-slate-500">
              Próximamente vas a poder conectar tu cuenta y recibir el dinero de tus ventas acá.
            </p>
          </div>
        </div>
      </Card>
    </form>
  );
}
