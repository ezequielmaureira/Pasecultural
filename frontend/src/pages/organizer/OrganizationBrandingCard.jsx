import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Palette } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useOrganizationTheme } from "../../context/OrganizationThemeContext.jsx";

// Identidad de la organización (ex "Personalización de marca") — Premium.
// La selección de colores/theme quedó CANCELADA como dirección de producto:
// Premium ahora usa siempre el Light Theme fijo de PaseCultural (ver
// lib/organizationTheme.js). La identidad de la Organization se logra
// exclusivamente con logo + nombre, nunca con colores propios.
// `organizationId` llega explícito desde OrganizerSettings (ya resuelto
// ahí). `plan` también llega desde el padre para no agregar un fetch nuevo
// sólo para decidir qué UI mostrar: la autorización real de todos modos
// vive en el backend (PATCH /:id/branding).
export default function OrganizationBrandingCard({ organizationId, plan, initialLogo }) {
  const { getToken } = useAuth();
  const toast = useToast();
  const { applyBrandingUpdate } = useOrganizationTheme();
  const isPremium = plan === "PREMIUM";

  const [logo, setLogo] = useState(initialLogo || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const token = await getToken();
      const { organization } = await apiFetch(`/api/organizations/${organizationId}/branding`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ logo: logo || null }),
      });
      setLogo(organization.logo || "");
      applyBrandingUpdate({ logo: organization.logo });
      toast.success("Identidad de la organización actualizada.");
    } catch (err) {
      setError(err.message || "No pudimos guardar el logo. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  // Preferencia explícita: no ocultar del todo la función a organizaciones
  // FREE — mostrarla deshabilitada/informativa ayuda a explicar el valor de
  // Premium, sin inventar acá ningún flujo de upgrade/pago que todavía no
  // existe.
  if (!isPremium) {
    return (
      <Card title="Identidad de la organización">
        <div className="flex items-start gap-3">
          <Palette className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p className="text-sm text-slate-400">
            Con PaseCultural Premium podés personalizar el logo de tu página pública de
            organización. Esta función está disponible sólo para organizaciones Premium.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Identidad de la organización">
      <div className="sm:max-w-xs">
        <ImageUploader label="Logo de la organización" value={logo} onChange={(url) => setLogo(url || "")} />
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
          Guardar
        </Button>
      </div>
    </Card>
  );
}
