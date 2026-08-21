import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Plus, Trash2, Save } from "lucide-react";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import Button from "../../components/ui/Button.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { formatCurrencyARS, formatDateTime } from "../../lib/format.js";
import { getServiceFeeConfig, updateServiceFeeConfig } from "../../lib/developerServiceFeeApi.js";
import { getDeveloperAlertConfig, updateDeveloperAlertConfig } from "../../lib/developerAlertConfigApi.js";

// MP-6 — Developer > Configuración. Única sección hoy (comisión de
// servicio de Mercado Pago); pensada como el punto de entrada para
// futuras configuraciones administrativas sin tener que crear una ruta
// nueva por cada una (ver Sidebar.jsx: "Configuración" ya existía como
// item deshabilitado, este cambio lo activa).
//
// El cálculo/validación autoritativos viven exclusivamente server-side
// (serviceFee.service.js) — esta pantalla nunca decide por su cuenta si
// un conjunto de rangos es válido, sólo edita y envía; los errores que
// se muestran son siempre los que devuelve el backend.

let nextRowKey = 0;
function makeRow({ minAmount = "", maxAmount = "", feeAmount = "", isOpenEnded = false } = {}) {
  return { _key: nextRowKey++, minAmount: String(minAmount), maxAmount: maxAmount == null ? "" : String(maxAmount), feeAmount: String(feeAmount), isOpenEnded };
}

function rowsFromConfig(tiers) {
  if (!tiers || tiers.length === 0) return [makeRow({ isOpenEnded: true })];
  return tiers.map((t) => makeRow({ minAmount: t.minAmount, maxAmount: t.maxAmount, feeAmount: t.feeAmount, isOpenEnded: t.maxAmount == null }));
}

// Estimación puramente visual para la previsualización — el backend
// revalida y recalcula todo de cero al guardar; esto nunca decide nada.
function estimateFee(price, rows) {
  if (!(price > 0)) return 0;
  const tier = rows.find((r) => {
    const min = Number(r.minAmount);
    const max = r.isOpenEnded ? null : Number(r.maxAmount);
    return Number.isFinite(min) && price >= min && (max === null || (Number.isFinite(max) && price < max));
  });
  return tier ? Number(tier.feeAmount) || 0 : null;
}

const PREVIEW_EXAMPLES = [
  { label: "1 entrada de $4.000", items: [{ price: 4000, qty: 1 }] },
  { label: "3 entradas de $8.000", items: [{ price: 8000, qty: 3 }] },
  { label: "3 entradas de $10.000", items: [{ price: 10000, qty: 3 }] },
  { label: "2 entradas de $120.000", items: [{ price: 120000, qty: 2 }] },
  { label: "Compra mixta: 2 × $8.000 + 1 × $60.000", items: [{ price: 8000, qty: 2 }, { price: 60000, qty: 1 }] },
];

function PreviewRow({ example, rows }) {
  let subtotal = 0;
  let fee = 0;
  let incomplete = false;
  for (const item of example.items) {
    const unitFee = estimateFee(item.price, rows);
    if (unitFee === null) incomplete = true;
    subtotal += item.price * item.qty;
    fee += (unitFee ?? 0) * item.qty;
  }
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="py-2 pr-3 text-slate-300">{example.label}</td>
      <td className="py-2 pr-3 text-slate-400">{formatCurrencyARS(subtotal)}</td>
      <td className="py-2 pr-3 text-slate-400">{incomplete ? "—" : formatCurrencyARS(fee)}</td>
      <td className="py-2 font-medium text-white">{incomplete ? "Rango incompleto" : formatCurrencyARS(subtotal + fee)}</td>
    </tr>
  );
}

// Alertas Developer — umbrales de las alertas de patrón/volumen (ver
// backend/src/services/developerAlertConfig.service.js). Sección aparte,
// propia, dentro del mismo panel "Configuración" (nunca un panel
// paralelo) — mismo criterio de autorización DEVELOPER que el resto de
// esta pantalla.
const ALERT_CONFIG_FIELDS = [
  { key: "highTicketPriceThreshold", label: "Precio de entrada que dispara alerta ($)", step: "0.01" },
  { key: "highSaleQuantityThreshold", label: "Cantidad de entradas por compra que dispara alerta" },
  { key: "eventsWindowCount", label: "Cantidad de eventos" },
  { key: "eventsWindowHours", label: "Ventana de eventos (horas)" },
  { key: "salesVolumeWindowCount", label: "Cantidad de ventas" },
  { key: "salesVolumeWindowMinutes", label: "Ventana de ventas (minutos)" },
  { key: "refundsVolumeWindowCount", label: "Cantidad de refunds" },
  { key: "refundsVolumeWindowHours", label: "Ventana de refunds (horas)" },
  { key: "withdrawalRequestsWindowCount", label: "Cantidad de solicitudes de arrepentimiento" },
  { key: "withdrawalRequestsWindowHours", label: "Ventana de solicitudes de arrepentimiento (horas)" },
  { key: "alertCooldownMinutes", label: "Cooldown entre alertas repetidas (minutos)" },
];

function emptyAlertConfigForm() {
  return Object.fromEntries(ALERT_CONFIG_FIELDS.map((f) => [f.key, ""]));
}

function alertConfigFormFromConfig(config) {
  return Object.fromEntries(ALERT_CONFIG_FIELDS.map((f) => [f.key, config ? String(config[f.key]) : ""]));
}

function DeveloperAlertConfigSection() {
  const { getToken } = useAuth();

  const [form, setForm] = useState(emptyAlertConfigForm());
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const [savedMessage, setSavedMessage] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      const config = await getDeveloperAlertConfig(token);
      setForm(alertConfigFormFromConfig(config));
      setUpdatedAt(config.updatedAt);
    } catch (err) {
      console.error("No se pudo cargar la configuración de alertas Developer", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaveError("");
    setValidationErrors([]);
    setSavedMessage("");
    setSaving(true);
    try {
      const token = await getToken();
      const config = await updateDeveloperAlertConfig(token, form);
      setForm(alertConfigFormFromConfig(config));
      setUpdatedAt(config.updatedAt);
      setSavedMessage("Configuración de alertas guardada.");
    } catch (err) {
      if (Array.isArray(err.errors) && err.errors.length > 0) {
        setValidationErrors(err.errors);
      } else {
        setSaveError(err.message || "No pudimos guardar la configuración de alertas.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Cargando configuración de alertas...</p>;
  }

  if (loadError) {
    return <InlineErrorNotice message="No pudimos cargar la configuración de alertas Developer." onRetry={load} />;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0B1120]/90 p-5">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-white">Alertas Developer</h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Umbrales de las alertas informativas de patrón/volumen (nunca bloquean nada: no cancelan ventas, no
          suspenden organizaciones, no tocan Mercado Pago). Se envían a la casilla configurada en
          DEVELOPER_ALERT_EMAIL.
        </p>
        {updatedAt && <p className="text-xs text-slate-600">Última modificación: {formatDateTime(updatedAt)}</p>}
      </div>

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ALERT_CONFIG_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              type="number"
              min={0}
              step={f.step ?? "1"}
              className={inputClass}
              value={form[f.key]}
              onChange={(e) => handleChange(f.key, e.target.value)}
            />
          </Field>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
          <Save className="h-4 w-4" />
          Guardar alertas
        </Button>
      </div>
    </div>
  );
}

export default function DeveloperSettings() {
  const { getToken } = useAuth();

  const [rows, setRows] = useState([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const [savedMessage, setSavedMessage] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      const config = await getServiceFeeConfig(token);
      setRows(rowsFromConfig(config.tiers));
      setLastUpdatedAt(config.lastUpdatedAt);
    } catch (err) {
      console.error("No se pudo cargar la configuración de comisión", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAdd() {
    setRows((prev) => [...prev.map((r) => ({ ...r, isOpenEnded: false })), makeRow({ isOpenEnded: true })]);
  }

  function handleRemove(index) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function handleChange(index, field, value) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === "isOpenEnded") return { ...row, isOpenEnded: value, maxAmount: value ? "" : row.maxAmount };
        return { ...row, [field]: value };
      })
    );
  }

  async function handleSave() {
    setSaveError("");
    setValidationErrors([]);
    setSavedMessage("");
    setSaving(true);
    try {
      const token = await getToken();
      const payload = rows.map((r) => ({
        minAmount: r.minAmount,
        maxAmount: r.isOpenEnded ? null : r.maxAmount,
        feeAmount: r.feeAmount,
      }));
      const config = await updateServiceFeeConfig(token, payload);
      setRows(rowsFromConfig(config.tiers));
      setLastUpdatedAt(config.lastUpdatedAt);
      setSavedMessage("Configuración guardada.");
    } catch (err) {
      if (Array.isArray(err.errors) && err.errors.length > 0) {
        setValidationErrors(err.errors);
      } else {
        setSaveError(err.message || "No pudimos guardar la configuración.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Cargando configuración...</p>;
  }

  if (loadError) {
    return <InlineErrorNotice message="No pudimos cargar la configuración de comisión." onRetry={load} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Configuración</h1>
        <p className="text-sm text-slate-400">Administrá la comisión de servicio que PaseCultural suma al comprador.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0B1120]/90 p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-white">Comisión de servicio (Mercado Pago)</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Se cobra por cada entrada, según su precio unitario, y se SUMA por encima del precio que definió el
            organizador — nunca se descuenta de él. Una entrada de $0 nunca tiene comisión. El último rango debe
            quedar sin límite superior, para cubrir cualquier precio mayor.
          </p>
          {lastUpdatedAt && <p className="text-xs text-slate-600">Última modificación: {formatDateTime(lastUpdatedAt)}</p>}
        </div>

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

        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row._key} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Rango {index + 1}
                  {row.isOpenEnded && " · sin límite superior"}
                </p>
                {rows.length > 1 && (
                  <button type="button" onClick={() => handleRemove(index)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Desde ($)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={row.minAmount}
                    onChange={(e) => handleChange(index, "minAmount", e.target.value)}
                  />
                </Field>
                <Field label="Hasta ($, sin incluir)">
                  {row.isOpenEnded ? (
                    <div className={`${inputClass} flex items-center text-slate-500`}>Sin límite superior</div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={row.maxAmount}
                      onChange={(e) => handleChange(index, "maxAmount", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Comisión por entrada ($)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={row.feeAmount}
                    onChange={(e) => handleChange(index, "feeAmount", e.target.value)}
                  />
                </Field>
              </div>

              <label className="flex w-fit items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={row.isOpenEnded}
                  onChange={(e) => handleChange(index, "isOpenEnded", e.target.checked)}
                />
                Sin límite superior (marcalo en el rango de mayor precio)
              </label>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAdd}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 hover:border-violet-500/60 hover:text-violet-300"
        >
          <Plus className="h-4 w-4" />
          Agregar rango
        </button>

        <div className="mt-5 flex justify-end">
          <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
            <Save className="h-4 w-4" />
            Guardar configuración
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0B1120]/90 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Previsualización</h2>
        <p className="mb-3 text-xs text-slate-500">
          Ejemplos calculados con los rangos de arriba (sin guardar todavía) — así podés revisar el resultado antes
          de confirmar.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Ejemplo</th>
                <th className="py-2 pr-3 font-medium">Entradas</th>
                <th className="py-2 pr-3 font-medium">Comisión</th>
                <th className="py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW_EXAMPLES.map((example) => (
                <PreviewRow key={example.label} example={example} rows={rows} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DeveloperAlertConfigSection />
    </div>
  );
}
