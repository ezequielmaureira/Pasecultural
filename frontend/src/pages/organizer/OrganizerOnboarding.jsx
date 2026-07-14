import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { Building2, ChevronRight } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import { apiFetch } from "../../lib/api.js";

function createEmptyOrganization(email) {
  return {
    name: "",
    description: "",
    phone: "",
    email: email ?? "",
    website: "",
    cuit: "",
  };
}

export default function OrganizerOnboarding() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState(() =>
    createEmptyOrganization(user?.primaryEmailAddress?.emailAddress)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const token = await getToken();
      await apiFetch("/api/organizations", {
        method: "POST",
        token,
        body: JSON.stringify(form),
      });
      navigate("/organizador", { replace: true });
    } catch (err) {
      console.error(err);
      setError("No pudimos crear tu organización. Probá de nuevo.");
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

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Nombre de la organización">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Ej: Estudio Cultural BA"
                required
              />
            </Field>

            <Field label="Descripción">
              <textarea
                className={textareaClass}
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Contanos a qué se dedica tu organización"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Email de contacto">
                <input
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="contacto@organizacion.com"
                  required
                />
              </Field>
              <Field label="Teléfono">
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+54 9 11 1234-5678"
                />
              </Field>
              <Field label="Sitio web">
                <input
                  className={inputClass}
                  value={form.website}
                  onChange={(e) => setField("website", e.target.value)}
                  placeholder="https://..."
                />
              </Field>
              <Field label="CUIT">
                <input
                  className={inputClass}
                  value={form.cuit}
                  onChange={(e) => setField("cuit", e.target.value)}
                  placeholder="30-12345678-9"
                />
              </Field>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="mt-2 justify-center"
            >
              {submitting ? "Creando..." : "Continuar"}
              {!submitting && <ChevronRight className="h-4 w-4" />}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
