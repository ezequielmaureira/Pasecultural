import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Save } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { getFestPassIntroContent, updateFestPassIntroContent } from "../../lib/contentApi.js";

// Developer > Contenido (V1 mínima) — administra UN único slot hoy: la
// imagen que reemplaza la introducción de Organizer > Fest Pass (ver
// components/organizer/FestPassIntro.jsx y su wrapper
// FestPassIntroContent.jsx). La imagen YA contiene todo el diseño
// (teléfono, textos, íconos) — acá nunca se reconstruye ni se superpone
// texto, sólo se sube/reemplaza el archivo completo y se activa/desactiva.
//
// Configuración GLOBAL (no por Organization): si Developer cambia la
// imagen o el estado, todos los Organizers lo ven al instante, sin
// redeploy — ver content.service.js (backend).
export default function DeveloperContent() {
  const { getToken } = useAuth();

  const [imageUrl, setImageUrl] = useState(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      const config = await getFestPassIntroContent(token);
      setImageUrl(config.imageUrl || null);
      setActive(Boolean(config.active));
    } catch (err) {
      console.error("No se pudo cargar la configuración de contenido", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaveError("");
    setSavedMessage("");
    setSaving(true);
    try {
      const token = await getToken();
      const config = await updateFestPassIntroContent(token, { imageUrl, active });
      setImageUrl(config.imageUrl || null);
      setActive(Boolean(config.active));
      setSavedMessage("Configuración guardada.");
    } catch (err) {
      setSaveError(err.message || "No pudimos guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Cargando contenido...</p>;
  }

  if (loadError) {
    return <InlineErrorNotice message="No pudimos cargar la configuración de contenido." onRetry={load} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Contenido</h1>
        <p className="text-sm text-slate-400">
          Administrá el contenido visual que aparece dentro de Smarticket.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0B1120]/90 p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-white">Fest Pass · Introducción</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Imagen mostrada al organizador antes del formulario de Fest Pass. Reemplaza por completo el bloque de
            explicación actual — la imagen ya contiene todo el diseño (teléfono, textos, íconos).
          </p>
        </div>

        {saveError && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
            <p className="text-sm text-rose-300">{saveError}</p>
          </div>
        )}
        {savedMessage && (
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-emerald-300">{savedMessage}</p>
          </div>
        )}

        <ImageUploader
          label="Imagen"
          helperText="PNG, JPG, JPEG o WEBP. Máximo 5 MB. Se muestra completa, sin recortar."
          value={imageUrl}
          onChange={setImageUrl}
          previewHeightClass="h-56"
        />

        <label className="mt-4 flex w-fit items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {active ? "Activa" : "Inactiva"}
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Con la card inactiva, Organizer ve la introducción actual (fallback) en vez de esta imagen.
        </p>

        <div className="mt-5 flex justify-end">
          <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
            <Save className="h-4 w-4" />
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
