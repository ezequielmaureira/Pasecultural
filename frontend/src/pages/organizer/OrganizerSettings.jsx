import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";
import WhatsappNumberChangeCard from "./WhatsappNumberChangeCard.jsx";
import MercadoPagoConnectionCard from "./MercadoPagoConnectionCard.jsx";
import OrganizerNotificationSettingsCard from "./OrganizerNotificationSettingsCard.jsx";

function FieldSkeleton({ className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
      <div className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
    </div>
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
  const [orgId, setOrgId] = useState(null);
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
          setOrgId(organization.id);
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

      {!loading && orgId && <WhatsappNumberChangeCard organizationId={orgId} organizationName={org.name} />}

      {/* MP-1 — onboarding OAuth de Mercado Pago (reemplaza el placeholder
          "Próximamente" que había acá). Sólo conecta la cuenta: todavía no
          hay configuración de comisión, movimientos, saldos ni checkout —
          eso es MP-2. */}
      {!loading && orgId && <MercadoPagoConnectionCard organizationId={orgId} />}

      {!loading && orgId && <OrganizerNotificationSettingsCard />}
    </form>
  );
}
