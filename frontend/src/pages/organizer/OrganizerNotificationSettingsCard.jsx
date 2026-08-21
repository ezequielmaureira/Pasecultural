import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, ShieldCheck } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { inputClass } from "../../components/ui/FormField.jsx";
import { getOrganizerNotificationSettings, updateOrganizerNotificationSettings } from "../../lib/organizerNotificationsApi.js";
import { useToast } from "../../context/ToastContext.jsx";

const DEFAULTS = {
  saleConfirmedEnabled: false,
  salesMilestoneEnabled: false,
  salesMilestoneCount: 100,
  lowStockEnabled: false,
  lowStockPercent: 20,
  eventReminderEnabled: false,
  eventReminderHoursBefore: 24,
  eventStartEnabled: false,
  eventEndEnabled: false,
  scannerActivityEnabled: false,
};

// Fila "[ ] Avisarme..." con un número opcional al lado — mismo checkbox
// simple en todo el bloque, sin librería de switches nueva (no hay ninguna
// en el sistema de diseño todavía).
function ToggleRow({ label, checked, onChange, numberField }) {
  return (
    <label className="flex flex-wrap items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500/40"
      />
      <span className="text-sm text-gray-100">{label}</span>
      {numberField && checked && (
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            min={numberField.min ?? 1}
            max={numberField.max}
            value={numberField.value}
            onChange={(e) => numberField.onChange(Number(e.target.value))}
            className={`${inputClass} h-8 w-20 px-2 text-center`}
          />
          <span className="text-xs text-slate-400">{numberField.suffix}</span>
        </span>
      )}
    </label>
  );
}

// Dashboard Organizador > Configuración > Notificaciones — bloque
// definitivo (ver el informe de entrega). Vive en la MISMA página que el
// resto de Configuración (OrganizerSettings.jsx), como el resto de las
// tarjetas — nunca un panel paralelo. Guardado propio (no comparte el botón
// "Guardar cambios" del formulario de datos de la organización): son
// recursos distintos en el backend (OrganizerNotificationSettings, no
// Organization), mismo criterio que MercadoPagoConnectionCard.
export default function OrganizerNotificationSettingsCard() {
  const { getToken } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const result = await getOrganizerNotificationSettings(token);
        if (!cancelled) setSettings({ ...DEFAULTS, ...result });
      } catch (err) {
        if (!cancelled) setError(err.message || "No pudimos cargar tus preferencias de notificaciones.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const { updatedAt, ...payload } = settings;
      const result = await updateOrganizerNotificationSettings(token, payload);
      setSettings({ ...DEFAULTS, ...result });
      setSavedAt(Date.now());
      toast.success("Preferencias de notificaciones guardadas.");
    } catch (err) {
      setError(err.message || "No pudimos guardar tus preferencias.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card title="Notificaciones">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded bg-white/5" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Notificaciones">
      <p className="mb-4 text-xs text-slate-400">
        Elegí qué avisos por correo querés recibir. Las alertas importantes no se pueden desactivar.
      </p>

      <div className="flex flex-col gap-1 border-b border-white/10 pb-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ventas</h4>
        <ToggleRow
          label="Avisarme por cada venta confirmada"
          checked={settings.saleConfirmedEnabled}
          onChange={(v) => setField("saleConfirmedEnabled", v)}
        />
        <ToggleRow
          label="Avisarme cada X entradas vendidas"
          checked={settings.salesMilestoneEnabled}
          onChange={(v) => setField("salesMilestoneEnabled", v)}
          numberField={{ value: settings.salesMilestoneCount, onChange: (v) => setField("salesMilestoneCount", v), suffix: "entradas" }}
        />
        <ToggleRow
          label="Avisarme cuando quede X% de stock"
          checked={settings.lowStockEnabled}
          onChange={(v) => setField("lowStockEnabled", v)}
          numberField={{ value: settings.lowStockPercent, onChange: (v) => setField("lowStockPercent", v), suffix: "%", max: 99 }}
        />
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          Entradas agotadas — siempre activo
        </p>
      </div>

      <div className="flex flex-col gap-1 border-b border-white/10 py-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Eventos</h4>
        <ToggleRow
          label="Recordarme antes del evento"
          checked={settings.eventReminderEnabled}
          onChange={(v) => setField("eventReminderEnabled", v)}
          numberField={{ value: settings.eventReminderHoursBefore, onChange: (v) => setField("eventReminderHoursBefore", v), suffix: "horas antes" }}
        />
        <ToggleRow
          label="Avisarme cuando comienza"
          checked={settings.eventStartEnabled}
          onChange={(v) => setField("eventStartEnabled", v)}
        />
        <ToggleRow
          label="Avisarme cuando termina"
          checked={settings.eventEndEnabled}
          onChange={(v) => setField("eventEndEnabled", v)}
        />
      </div>

      <div className="flex flex-col gap-1 border-b border-white/10 py-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Scanner / Ingresos</h4>
        <ToggleRow
          label="Recibir notificaciones de actividad de ingresos"
          checked={settings.scannerActivityEnabled}
          onChange={(v) => setField("scannerActivityEnabled", v)}
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Alertas importantes (siempre activas)</h4>
        {["Solicitudes de arrepentimiento", "Entradas agotadas", "Mercado Pago desconectado", "Problema de Mercado Pago que requiere intervención"].map(
          (label) => (
            <p key={label} className="flex items-center gap-1.5 text-sm text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              {label}
            </p>
          )
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button type="button" onClick={handleSave} loading={saving} loadingText="Guardando...">
          Guardar preferencias
        </Button>
        {error && <span className="text-xs text-rose-400">{error}</span>}
        {savedAt && !error && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Check className="h-4 w-4" />
            Guardado
          </span>
        )}
      </div>
    </Card>
  );
}
