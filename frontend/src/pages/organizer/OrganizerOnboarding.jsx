import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { Building2, ChevronRight, ChevronLeft } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";
import { ORGANIZATION_TYPES } from "../../lib/organizationTypes.js";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

function createEmptyOrganization(email) {
  return {
    name: "",
    type: "",
    email: email ?? "",
    phone: "",
    responsibleFirstName: "",
    responsibleLastName: "",
    logo: "",
    description: "",
    province: "",
    city: "",
    website: "",
    instagram: "",
    facebook: "",
    tiktok: "",
    cuit: "",
    responsibleDni: "",
  };
}

function validateStep1(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = "El nombre es obligatorio";
  if (!form.type) errors.type = "Elegí un tipo de organización";
  if (!EMAIL_REGEX.test(form.email)) errors.email = "Ingresá un email válido";
  if (!form.phone.trim()) errors.phone = "El teléfono es obligatorio";
  if (!form.responsibleFirstName.trim())
    errors.responsibleFirstName = "El nombre del responsable es obligatorio";
  if (!form.responsibleLastName.trim())
    errors.responsibleLastName = "El apellido del responsable es obligatorio";
  return errors;
}

function validateStep2(form) {
  const errors = {};
  if (!form.province.trim()) errors.province = "La provincia es obligatoria";
  if (!form.city.trim()) errors.city = "La ciudad es obligatoria";
  if (!form.cuit.trim() && !form.responsibleDni.trim()) {
    errors.cuit = "Indicá el CUIT o el DNI del responsable";
    errors.responsibleDni = "Indicá el CUIT o el DNI del responsable";
  }
  return errors;
}

function ErrorText({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-rose-400">{message}</p>;
}

function StepIndicator({ step }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-3">
      {[1, 2].map((n) => (
        <div key={n} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-150 ${
              n === step
                ? "bg-violet-600 text-white"
                : n < step
                ? "bg-violet-500/20 text-violet-300"
                : "bg-white/5 text-slate-500"
            }`}
          >
            {n}
          </div>
          {n === 1 && <div className="h-px w-10 bg-white/10" />}
        </div>
      ))}
    </div>
  );
}

export default function OrganizerOnboarding() {
  const { getToken } = useAuth();
  const toast = useToast();
  const { user } = useUser();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() =>
    createEmptyOrganization(user?.primaryEmailAddress?.emailAddress)
  );
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization } = await apiFetch("/api/organizations/me", {
          token,
        });
        if (!cancelled && organization) {
          navigate("/organizador", { replace: true });
          return;
        }
      } catch (err) {
        console.error("No se pudo verificar la organización", err);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, navigate]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleContinue(event) {
    event.preventDefault();
    const stepErrors = validateStep1(form);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep(2);
  }

  function handleBack() {
    setStep(1);
    setErrors({});
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const stepErrors = validateStep2(form);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const token = await getToken();
      await apiFetch("/api/organizations", {
        method: "POST",
        token,
        body: JSON.stringify(form),
      });
      toast.success("¡Organización creada! La enviamos a revisión.");
      navigate("/organizador", { replace: true });
    } catch (err) {
      console.error(err);
      setSubmitError(
        err.message || "No pudimos enviar tu organización a revisión. Probá de nuevo."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#05070B] text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-violet-500" />
        <p className="text-sm">Verificando tu cuenta...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05070B] px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-white">Creá tu organización</h1>
          <p className="max-w-sm text-sm text-slate-400">
            Con estos datos vamos a revisar y aprobar tu cuenta de organizador.
            Mientras tanto ya podés armar tus eventos en borrador.
          </p>
        </div>

        <StepIndicator step={step} />

        <Card>
          {step === 1 ? (
            <form onSubmit={handleContinue} className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-white">
                Paso 1 · Información básica
              </p>

              <Field label="Nombre de la organización" required>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="Ej: Estudio Cultural BA"
                />
                <ErrorText message={errors.name} />
              </Field>

              <Field label="Tipo de organización" required>
                <select
                  className={inputClass}
                  value={form.type}
                  onChange={(e) => setField("type", e.target.value)}
                >
                  <option value="">Seleccioná un tipo</option>
                  {ORGANIZATION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <ErrorText message={errors.type} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email de contacto" required>
                  <input
                    type="email"
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    placeholder="contacto@organizacion.com"
                  />
                  <ErrorText message={errors.email} />
                </Field>
                <Field label="Teléfono" required>
                  <input
                    className={inputClass}
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    placeholder="+54 9 11 1234-5678"
                  />
                  <ErrorText message={errors.phone} />
                </Field>
                <Field label="Nombre del responsable" required>
                  <input
                    className={inputClass}
                    value={form.responsibleFirstName}
                    onChange={(e) => setField("responsibleFirstName", e.target.value)}
                    placeholder="Nombre"
                  />
                  <ErrorText message={errors.responsibleFirstName} />
                </Field>
                <Field label="Apellido del responsable" required>
                  <input
                    className={inputClass}
                    value={form.responsibleLastName}
                    onChange={(e) => setField("responsibleLastName", e.target.value)}
                    placeholder="Apellido"
                  />
                  <ErrorText message={errors.responsibleLastName} />
                </Field>
              </div>

              <Button type="submit" size="lg" className="mt-2 justify-center">
                Continuar
                <ChevronRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-white">Paso 2 · Perfil</p>

              <ImageUploader
                label="Logo"
                value={form.logo}
                onChange={(url) => setField("logo", url || "")}
              />

              <Field label="Descripción">
                <textarea
                  className={textareaClass}
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  placeholder="Contanos a qué se dedica tu organización"
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Provincia" required>
                  <input
                    className={inputClass}
                    value={form.province}
                    onChange={(e) => setField("province", e.target.value)}
                    placeholder="Ej: Córdoba"
                  />
                  <ErrorText message={errors.province} />
                </Field>
                <Field label="Ciudad" required>
                  <input
                    className={inputClass}
                    value={form.city}
                    onChange={(e) => setField("city", e.target.value)}
                    placeholder="Ej: Villa María"
                  />
                  <ErrorText message={errors.city} />
                </Field>
                <Field label="Sitio web">
                  <input
                    className={inputClass}
                    value={form.website}
                    onChange={(e) => setField("website", e.target.value)}
                    placeholder="https://..."
                  />
                </Field>
                <Field label="Instagram">
                  <input
                    className={inputClass}
                    value={form.instagram}
                    onChange={(e) => setField("instagram", e.target.value)}
                    placeholder="@usuario"
                  />
                </Field>
                <Field label="Facebook">
                  <input
                    className={inputClass}
                    value={form.facebook}
                    onChange={(e) => setField("facebook", e.target.value)}
                    placeholder="facebook.com/pagina"
                  />
                </Field>
                <Field label="TikTok">
                  <input
                    className={inputClass}
                    value={form.tiktok}
                    onChange={(e) => setField("tiktok", e.target.value)}
                    placeholder="@usuario"
                  />
                </Field>
                <Field label="CUIT">
                  <input
                    className={inputClass}
                    value={form.cuit}
                    onChange={(e) => setField("cuit", e.target.value)}
                    placeholder="30-12345678-9"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Obligatorio si no cargás el DNI del responsable.
                  </p>
                  <ErrorText message={errors.cuit} />
                </Field>
                <Field label="DNI del responsable">
                  <input
                    className={inputClass}
                    value={form.responsibleDni}
                    onChange={(e) => setField("responsibleDni", e.target.value)}
                    placeholder="Obligatorio si no hay CUIT"
                  />
                  <ErrorText message={errors.responsibleDni} />
                </Field>
              </div>

              {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

              <div className="mt-2 flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBack}
                  disabled={submitting}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Atrás
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  disabled={submitting}
                  className="flex-1 justify-center"
                >
                  {submitting ? "Enviando..." : "Enviar para revisión"}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
