import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { apiFetch } from "../../lib/api.js";

const inputClass =
  "h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20";
const textareaClass = `${inputClass} h-24 resize-none py-2`;

function Field({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
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

const INITIAL_BANK = {
  mercadoPagoConnected: false,
  cbu: "",
  alias: "",
};

export default function OrganizerSettings() {
  const { getToken } = useAuth();
  const [org, setOrg] = useState(EMPTY_ORG);
  const [bank, setBank] = useState(INITIAL_BANK);
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

  function setBankField(key, value) {
    setBank((prev) => ({ ...prev, [key]: value }));
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
          <Button type="submit" disabled={loading || saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </div>

      <Card title="Datos del organizador">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 sm:max-w-xs">
            <ImageUploader
              label="Logo"
              value={org.logo}
              onChange={(url) => setOrgField("logo", url || "")}
            />
          </div>
          <Field label="Nombre comercial">
            <input
              className={inputClass}
              value={org.name}
              onChange={(e) => setOrgField("name", e.target.value)}
            />
          </Field>
          <Field label="CUIT">
            <input
              className={inputClass}
              value={org.cuit}
              onChange={(e) => setOrgField("cuit", e.target.value)}
            />
          </Field>
          <Field label="Correo">
            <input
              type="email"
              className={inputClass}
              value={org.email}
              onChange={(e) => setOrgField("email", e.target.value)}
            />
          </Field>
          <Field label="Teléfono">
            <input
              className={inputClass}
              value={org.phone}
              onChange={(e) => setOrgField("phone", e.target.value)}
            />
          </Field>
          <Field label="Provincia">
            <input
              className={inputClass}
              value={org.province}
              onChange={(e) => setOrgField("province", e.target.value)}
            />
          </Field>
          <Field label="Ciudad">
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
      </Card>

      <Card title="Datos bancarios">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-lg border border-white/10 p-4">
            <div>
              <p className="text-sm font-medium text-white">Mercado Pago</p>
              <p className="text-xs text-slate-500">
                {bank.mercadoPagoConnected
                  ? "Cuenta conectada"
                  : "No conectado"}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setBankField("mercadoPagoConnected", !bank.mercadoPagoConnected)
              }
            >
              {bank.mercadoPagoConnected ? "Desconectar" : "Conectar"}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="CBU">
              <input
                className={inputClass}
                value={bank.cbu}
                onChange={(e) => setBankField("cbu", e.target.value)}
                placeholder="0000000000000000000000"
              />
            </Field>
            <Field label="Alias">
              <input
                className={inputClass}
                value={bank.alias}
                onChange={(e) => setBankField("alias", e.target.value)}
                placeholder="mi.alias.mp"
              />
            </Field>
          </div>
        </div>
      </Card>
    </form>
  );
}
