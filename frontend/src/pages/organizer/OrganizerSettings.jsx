import { useState } from "react";
import { ImageIcon, Check } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";

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

const INITIAL_ORG = {
  commercialName: "PaseCultural Producciones",
  cuit: "30-12345678-9",
  email: "contacto@pasecultural.com",
  phone: "+54 11 5555-5555",
  address: "Av. Corrientes 1234, CABA",
  website: "https://pasecultural.com",
  socialMedia: "@pasecultural",
  policies: "Política de reembolsos y términos generales de los eventos.",
};

const INITIAL_BANK = {
  mercadoPagoConnected: false,
  cbu: "",
  alias: "",
};

export default function OrganizerSettings() {
  const [org, setOrg] = useState(INITIAL_ORG);
  const [bank, setBank] = useState(INITIAL_BANK);
  const [savedAt, setSavedAt] = useState(null);

  function setOrgField(key, value) {
    setOrg((prev) => ({ ...prev, [key]: value }));
  }

  function setBankField(key, value) {
    setBank((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(event) {
    event.preventDefault();
    setSavedAt(Date.now());
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
          {savedAt && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="h-4 w-4" />
              Cambios guardados
            </span>
          )}
          <Button type="submit">Guardar cambios</Button>
        </div>
      </div>

      <Card title="Datos del organizador">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 sm:col-span-2">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/15 text-slate-500">
              <ImageIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Logo</p>
              <p className="text-xs text-slate-500">
                La carga de imágenes estará disponible próximamente.
              </p>
            </div>
          </div>
          <Field label="Nombre comercial">
            <input
              className={inputClass}
              value={org.commercialName}
              onChange={(e) => setOrgField("commercialName", e.target.value)}
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
          <Field label="Dirección" className="sm:col-span-2">
            <input
              className={inputClass}
              value={org.address}
              onChange={(e) => setOrgField("address", e.target.value)}
            />
          </Field>
          <Field label="Sitio web">
            <input
              className={inputClass}
              value={org.website}
              onChange={(e) => setOrgField("website", e.target.value)}
            />
          </Field>
          <Field label="Redes sociales">
            <input
              className={inputClass}
              value={org.socialMedia}
              onChange={(e) => setOrgField("socialMedia", e.target.value)}
            />
          </Field>
          <Field label="Políticas" className="sm:col-span-2">
            <textarea
              className={textareaClass}
              value={org.policies}
              onChange={(e) => setOrgField("policies", e.target.value)}
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
