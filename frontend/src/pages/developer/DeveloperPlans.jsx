import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Save } from "lucide-react";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import Button from "../../components/ui/Button.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { getDeveloperPlanLimits, updateDeveloperPlanLimits } from "../../lib/developerPlanLimitsApi.js";

// Developer > Planes — pantalla propia y separada de Developer >
// Configuración (antes vivía ahí como "Límites por plan", ver el informe
// de la ronda "Developer > Planes"). Misma infraestructura de siempre
// (organizationPlanPolicy.js / OrganizationPlanLimits) — esta pantalla NO
// crea un segundo sistema, sólo la mueve y la completa con las 6 reglas
// reales acordadas. "Cortesías por evento" queda deliberadamente afuera:
// dejó de ser una regla de FREE/PREMIUM (la columna histórica sigue viva
// en la base, sin exponerse acá).

const NUMBER_FIELDS = [
  { key: "maxActiveEvents", label: "Eventos activos" },
  { key: "maxActiveScanners", label: "Scanners activos" },
  { key: "maxTicketsPerEvent", label: "Entradas máximas por evento" },
];

const BOOLEAN_FIELDS = [
  { key: "publicOrgPageEnabled", label: "Página pública propia" },
  { key: "whatsappEventCreationEnabled", label: "Carga de eventos por WhatsApp" },
  { key: "featuredEligible", label: "Puede ser organización destacada" },
];

const PLAN_LABELS = { FREE: "Plan Free", PREMIUM: "Plan Premium" };

// value: number|null -> fila de edición { value: string, unlimited: bool }.
// "Sin límite" es un checkbox explícito, nunca un input vacío — así el
// Developer nunca tiene que escribir "null" a mano ni confundirse con un
// campo en blanco.
function numberRowFromValue(value) {
  return value === null || value === undefined ? { value: "", unlimited: true } : { value: String(value), unlimited: false };
}

function formFromLimits(limits) {
  return {
    ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, numberRowFromValue(limits ? limits[f.key] : null)])),
    ...Object.fromEntries(BOOLEAN_FIELDS.map((f) => [f.key, limits ? Boolean(limits[f.key]) : false])),
  };
}

function ToggleField({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 light:border-slate-300 light:bg-white">
      <span className="text-sm text-slate-300 light:text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${
          checked ? "bg-violet-500" : "bg-white/15 light:bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function PlanBlock({ plan, initialLimits, getToken, onSaved }) {
  const [form, setForm] = useState(() => formFromLimits(initialLimits));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    setForm(formFromLimits(initialLimits));
  }, [initialLimits]);

  function handleValueChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], value } }));
    setSavedMessage("");
  }

  function handleUnlimitedChange(key, unlimited) {
    setForm((prev) => ({ ...prev, [key]: { value: unlimited ? "" : prev[key].value, unlimited } }));
    setSavedMessage("");
  }

  function handleBooleanChange(key, checked) {
    setForm((prev) => ({ ...prev, [key]: checked }));
    setSavedMessage("");
  }

  async function handleSave() {
    setSaveError("");
    setValidationErrors([]);
    setSavedMessage("");
    setSaving(true);
    try {
      const token = await getToken();
      const payload = {
        ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, form[f.key].unlimited ? null : form[f.key].value])),
        ...Object.fromEntries(BOOLEAN_FIELDS.map((f) => [f.key, form[f.key]])),
      };
      const updated = await updateDeveloperPlanLimits(token, plan, payload);
      setForm(formFromLimits(updated));
      setSavedMessage(`Plan ${PLAN_LABELS[plan].toLowerCase()} guardado.`);
      onSaved?.(updated);
    } catch (err) {
      if (Array.isArray(err.errors) && err.errors.length > 0) {
        setValidationErrors(err.errors);
      } else {
        setSaveError(err.message || "No pudimos guardar el plan.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0B1120]/90 p-5 light:border-slate-200 light:bg-white">
      <h2 className="mb-4 text-base font-semibold text-white light:text-slate-900">{PLAN_LABELS[plan]}</h2>

      {(saveError || validationErrors.length > 0) && (
        <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          {saveError && <p className="text-sm text-rose-300">{saveError}</p>}
          {validationErrors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-sm text-rose-300">
              {validationErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {savedMessage && (
        <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-sm text-emerald-300">{savedMessage}</p>
        </div>
      )}

      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Límites</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {NUMBER_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                type="number"
                min={0}
                step="1"
                className={inputClass}
                value={form[f.key].value}
                disabled={form[f.key].unlimited}
                onChange={(e) => handleValueChange(f.key, e.target.value)}
              />
              <label className="mt-1.5 flex w-fit items-center gap-2 text-xs text-slate-400 light:text-slate-500">
                <input
                  type="checkbox"
                  checked={form[f.key].unlimited}
                  onChange={(e) => handleUnlimitedChange(f.key, e.target.checked)}
                />
                Sin límite
              </label>
            </Field>
          ))}
        </div>
      </div>

      <div className="mb-2">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Funciones</h3>
        <div className="flex flex-col gap-2">
          {BOOLEAN_FIELDS.map((f) => (
            <ToggleField
              key={f.key}
              label={f.label}
              checked={form[f.key]}
              onChange={(checked) => handleBooleanChange(f.key, checked)}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
          <Save className="h-4 w-4" />
          Guardar plan {PLAN_LABELS[plan].split(" ")[1].toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

export default function DeveloperPlans() {
  const { getToken } = useAuth();

  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      const data = await getDeveloperPlanLimits(token);
      setLimits(data);
    } catch (err) {
      console.error("No se pudo cargar la configuración de planes", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white light:text-slate-900">Planes</h1>
        <p className="text-sm text-slate-400 light:text-slate-600">
          Configurá los límites y funcionalidades disponibles para los planes FREE y PREMIUM.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400">Cargando planes...</p>}

      {!loading && loadError && (
        <InlineErrorNotice message="No pudimos cargar la configuración de planes." onRetry={load} />
      )}

      {!loading && !loadError && limits && (
        <div className="flex flex-col gap-6">
          <PlanBlock
            plan="FREE"
            initialLimits={limits.FREE}
            getToken={getToken}
            onSaved={(updated) => setLimits((prev) => ({ ...prev, FREE: updated }))}
          />
          <PlanBlock
            plan="PREMIUM"
            initialLimits={limits.PREMIUM}
            getToken={getToken}
            onSaved={(updated) => setLimits((prev) => ({ ...prev, PREMIUM: updated }))}
          />
        </div>
      )}
    </div>
  );
}
