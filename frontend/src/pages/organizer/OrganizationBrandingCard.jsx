import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Palette } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useOrganizationTheme } from "../../context/OrganizationThemeContext.jsx";

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Premium — Fase 2D. `organizationId` llega explícito desde OrganizerSettings
// (ya resuelto ahí) — este componente nunca resuelve la Organization por su
// cuenta. `plan` también llega desde el padre (ya lo tenía cargado) para no
// agregar un fetch nuevo sólo para decidir qué UI mostrar: la autorización
// real de todos modos vive en el backend (PATCH /:id/branding), acá es sólo
// para no mostrar controles editables a quien el backend igual rechazaría.
export default function OrganizationBrandingCard({
  organizationId,
  plan,
  initialLogo,
  initialColor,
  initialSecondaryColor,
}) {
  const { getToken } = useAuth();
  const toast = useToast();
  const { applyBrandingUpdate } = useOrganizationTheme();
  const isPremium = plan === "PREMIUM";

  const [logo, setLogo] = useState(initialLogo || "");
  const [color, setColor] = useState(initialColor || "");
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const colorIsValid = color === "" || HEX_COLOR_REGEX.test(color);
  const secondaryColorIsValid = secondaryColor === "" || HEX_COLOR_REGEX.test(secondaryColor);

  async function handleSave() {
    if (!colorIsValid || !secondaryColorIsValid) {
      setError("Los colores deben tener el formato #RRGGBB.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const token = await getToken();
      const { organization } = await apiFetch(`/api/organizations/${organizationId}/branding`, {
        token,
        method: "PATCH",
        body: JSON.stringify({
          logo: logo || null,
          brandPrimaryColor: color || null,
          brandSecondaryColor: secondaryColor || null,
        }),
      });
      setLogo(organization.logo || "");
      setColor(organization.brandPrimaryColor || "");
      setSecondaryColor(organization.brandSecondaryColor || "");
      // Organization Theme (dashboard) — Premium Fase 2D.1/2D.1.1: propaga
      // al Context compartido (Sidebar/AppShell) sin logout/login/refresh.
      applyBrandingUpdate({
        logo: organization.logo,
        brandPrimaryColor: organization.brandPrimaryColor,
        brandSecondaryColor: organization.brandSecondaryColor,
      });
      toast.success("Branding actualizado.");
    } catch (err) {
      setError(err.message || "No pudimos guardar el branding. Probá de nuevo.");
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
      <Card title="Personalización de marca">
        <div className="flex items-start gap-3">
          <Palette className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p className="text-sm text-slate-400">
            Con PaseCultural Premium podés personalizar el logo y el color de tu página
            pública de organización. Esta función está disponible sólo para organizaciones
            Premium.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Personalización de marca">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 sm:max-w-xs">
          <ImageUploader
            label="Logo de marca"
            value={logo}
            onChange={(url) => setLogo(url || "")}
          />
        </div>
        <Field label="Color principal">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colorIsValid && color ? color : "#7c3aed"}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-white/5"
            />
            <input
              className={inputClass}
              placeholder="#7C3AED"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </Field>
        <Field label="Color secundario">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={secondaryColorIsValid && secondaryColor ? secondaryColor : "#0b1120"}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-white/5"
            />
            <input
              className={inputClass}
              placeholder="#0B1120"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
            />
          </div>
        </Field>
      </div>

      {!colorIsValid && (
        <p className="mt-2 text-xs text-rose-400">El color principal debe tener el formato #RRGGBB.</p>
      )}
      {!secondaryColorIsValid && (
        <p className="mt-2 text-xs text-rose-400">El color secundario debe tener el formato #RRGGBB.</p>
      )}
      {error && colorIsValid && secondaryColorIsValid && (
        <p className="mt-2 text-xs text-rose-400">{error}</p>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleSave}
          loading={saving}
          loadingText="Guardando..."
          disabled={!colorIsValid || !secondaryColorIsValid}
        >
          Guardar branding
        </Button>
      </div>
    </Card>
  );
}
