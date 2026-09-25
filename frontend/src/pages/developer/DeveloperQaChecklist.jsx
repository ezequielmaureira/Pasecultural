import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";
import ProgressBar from "../../components/ui/ProgressBar.jsx";
import SearchInput from "../../components/ui/SearchInput.jsx";
import Accordion from "../../components/ui/Accordion.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { formatShortDate } from "../../lib/format.js";
import { getQaChecklist, updateQaChecklistItem } from "../../lib/developerQaChecklistApi.js";
import { useToast } from "../../context/ToastContext.jsx";

// Developer > QA / Checklist — tablero PERSONAL de QA manual: el Developer
// prueba una funcionalidad a mano en la app real y, si funciona, la tilda.
// Deliberadamente NO es un sistema de testing: sin casos de prueba, sin
// pasos, sin resultado esperado, sin severidad, sin historial. La
// definición de cada funcionalidad vive en código (ver
// backend/src/qa/qaChecklistCatalog.js); esta pantalla sólo lee/escribe su
// estado (checked) contra GET/PATCH /api/developer/qa-checklist.

const ROLE_ORDER = ["DEVELOPER", "ORGANIZER", "SCANNER", "ASISTENTE"];
const ROLE_LABEL = {
  DEVELOPER: "Developer",
  ORGANIZER: "Organizer",
  SCANNER: "Scanner",
  ASISTENTE: "Asistente",
};

const FILTERS = [
  { id: "ALL", label: "Todas" },
  { id: "PENDING", label: "Pendientes" },
  { id: "CHECKED", label: "Verificadas" },
];

function toneForPercent(percent) {
  if (percent >= 80) return "success";
  if (percent >= 40) return "warning";
  return "danger";
}

// Misma fórmula, sin pesos, en 3 niveles — se recalcula en el cliente a
// partir de `items` (nunca de la respuesta cacheada de GET) para que un
// tilde/destilde se refleje en el header y en cada acordeón al instante,
// sin esperar un refetch.
function computeStats(items) {
  const global = { checked: 0, total: items.length };
  const byRole = new Map();

  for (const item of items) {
    if (!byRole.has(item.role)) byRole.set(item.role, { checked: 0, total: 0, entities: new Map() });
    const role = byRole.get(item.role);
    role.total += 1;
    if (!role.entities.has(item.entity)) role.entities.set(item.entity, { checked: 0, total: 0 });
    const entity = role.entities.get(item.entity);
    entity.total += 1;
    if (item.checked) {
      global.checked += 1;
      role.checked += 1;
      entity.checked += 1;
    }
  }

  const percent = (bucket) => (bucket.total > 0 ? Math.round((bucket.checked / bucket.total) * 100) : 0);

  return {
    global: { ...global, percent: percent(global) },
    byRole,
    percentOf: percent,
  };
}

function ChecklistItemRow({ item, pending, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      disabled={pending}
      aria-pressed={item.checked}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ${
          item.checked
            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
            : "border-white/20 bg-transparent text-transparent"
        }`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${item.checked ? "text-slate-300" : "text-slate-200"}`}>{item.label}</span>
        {item.checked && item.checkedAt && (
          <span className="mt-0.5 block text-xs text-slate-500">Verificado {formatShortDate(item.checkedAt)}</span>
        )}
      </span>
    </button>
  );
}

function EntityBlock({ role, entity, items, expanded, onToggleExpand, pendingKeys, onToggleItem }) {
  const stats = useMemo(() => {
    const total = items.length;
    const checked = items.filter((i) => i.checked).length;
    return { checked, total, percent: total > 0 ? Math.round((checked / total) * 100) : 0 };
  }, [items]);

  return (
    <Accordion
      expanded={expanded}
      onToggle={() => onToggleExpand(`${role}:${entity}`)}
      title={entity}
      subtitle={`${stats.checked} / ${stats.total} verificadas`}
      actions={<Badge tone={toneForPercent(stats.percent)}>{stats.percent}%</Badge>}
    >
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <ChecklistItemRow
            key={item.key}
            item={item}
            pending={pendingKeys.has(item.key)}
            onToggle={onToggleItem}
          />
        ))}
      </div>
    </Accordion>
  );
}

export default function DeveloperQaChecklist() {
  const { getToken } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [expandedEntities, setExpandedEntities] = useState(() => new Set());
  const [pendingKeys, setPendingKeys] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getToken();
      const data = await getQaChecklist(token);
      setItems(data.items ?? []);
    } catch (err) {
      console.error("No se pudo cargar el checklist de QA", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => computeStats(items), [items]);

  const normalizedSearch = search.trim().toLowerCase();
  const isFiltering = filter !== "ALL" || normalizedSearch.length > 0;

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === "PENDING" && item.checked) return false;
      if (filter === "CHECKED" && !item.checked) return false;
      if (normalizedSearch && !item.label.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [items, filter, normalizedSearch]);

  const groupedByRole = useMemo(() => {
    const byRole = new Map();
    for (const item of visibleItems) {
      if (!byRole.has(item.role)) byRole.set(item.role, new Map());
      const byEntity = byRole.get(item.role);
      if (!byEntity.has(item.entity)) byEntity.set(item.entity, []);
      byEntity.get(item.entity).push(item);
    }
    return byRole;
  }, [visibleItems]);

  function toggleEntityExpanded(entityKey) {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityKey)) next.delete(entityKey);
      else next.add(entityKey);
      return next;
    });
  }

  async function handleToggleItem(item) {
    const key = item.key;
    const nextChecked = !item.checked;
    const previous = { checked: item.checked, checkedAt: item.checkedAt };

    setPendingKeys((prev) => new Set(prev).add(key));
    setItems((prev) =>
      prev.map((i) =>
        i.key === key ? { ...i, checked: nextChecked, checkedAt: nextChecked ? new Date().toISOString() : null } : i
      )
    );

    try {
      const token = await getToken();
      const { item: updated } = await updateQaChecklistItem(token, key, nextChecked);
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...updated } : i)));
    } catch (err) {
      console.error("No se pudo actualizar el checklist de QA", err);
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...previous } : i)));
      toast.error(err.message || "No pudimos guardar el cambio. Probá de nuevo.");
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white light:text-slate-900">QA / Checklist</h1>
        <p className="text-sm text-slate-400 light:text-slate-600">
          Tablero personal: probá cada funcionalidad manualmente en la app y tildala si funciona.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400">Cargando checklist...</p>}

      {!loading && loadError && <InlineErrorNotice message="No pudimos cargar el checklist de QA." onRetry={load} />}

      {!loading && !loadError && (
        <>
          <div className="rounded-2xl border border-white/10 bg-[#111713]/90 p-5 light:border-slate-200 light:bg-white">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-white light:text-slate-900">Progreso general</p>
              <p className="text-sm text-slate-400 light:text-slate-600">
                {stats.global.checked} / {stats.global.total} funcionalidades verificadas
              </p>
            </div>
            <ProgressBar value={stats.global.checked} max={stats.global.total} tone={toneForPercent(stats.global.percent)} />

            <div className="mt-4 flex flex-wrap gap-2">
              {ROLE_ORDER.map((role) => {
                const bucket = stats.byRole.get(role);
                const percent = bucket ? stats.percentOf(bucket) : 0;
                return (
                  <Badge key={role} tone={toneForPercent(percent)} className="py-1.5">
                    {ROLE_LABEL[role]} {percent}%
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                    filter === f.id
                      ? "bg-brand/10 text-brand-soft"
                      : "text-slate-400 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <SearchInput
              placeholder="Buscar funcionalidad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-72"
            />
          </div>

          <div className="flex flex-col gap-6">
            {ROLE_ORDER.map((role) => {
              const byEntity = groupedByRole.get(role);
              if (!byEntity || byEntity.size === 0) return null;

              const bucket = stats.byRole.get(role);
              const rolePercent = bucket ? stats.percentOf(bucket) : 0;

              return (
                <div key={role} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <h2 className="text-base font-bold uppercase tracking-wide text-white light:text-slate-900">
                      {ROLE_LABEL[role]}
                    </h2>
                    <Badge tone={toneForPercent(rolePercent)}>{rolePercent}%</Badge>
                  </div>

                  <div className="flex flex-col gap-2">
                    {Array.from(byEntity.entries()).map(([entity, entityItems]) => (
                      <EntityBlock
                        key={entity}
                        role={role}
                        entity={entity}
                        items={entityItems}
                        expanded={isFiltering || expandedEntities.has(`${role}:${entity}`)}
                        onToggleExpand={toggleEntityExpanded}
                        pendingKeys={pendingKeys}
                        onToggleItem={handleToggleItem}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {groupedByRole.size === 0 && (
              <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-400">
                No hay funcionalidades que coincidan con la búsqueda/filtro.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
