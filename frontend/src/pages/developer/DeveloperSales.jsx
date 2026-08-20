import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, Receipt, Eye } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";
import Drawer from "../../components/ui/Drawer.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { formatDateTime, formatCurrencyARS } from "../../lib/format.js";
import { getDeveloperOrganizationOptions } from "../../lib/developerEventsApi.js";
import { getDeveloperEventOptions } from "../../lib/developerTicketsApi.js";
import { listDeveloperSales, getDeveloperSale } from "../../lib/developerSalesApi.js";

// SaleStatus — sin mapa reutilizable exportado (SALE_STATUS_LABEL/TONE de
// SalesTable.jsx no están exportados); local acá, mismos labels/tonos que
// esa pantalla para mantener consistencia visual sin importar el archivo.
const STATUS_LABEL = { PENDING: "Pendiente", CONFIRMED: "Confirmada", CANCELLED: "Cancelada", EXPIRED: "Vencida" };
const STATUS_TONE = { PENDING: "warning", CONFIRMED: "success", CANCELLED: "danger", EXPIRED: "neutral" };

const STATUS_FILTERS = [
  { id: "", label: "Todos" },
  { id: "PENDING", label: "Pendiente" },
  { id: "CONFIRMED", label: "Confirmada" },
  { id: "CANCELLED", label: "Cancelada" },
  { id: "EXPIRED", label: "Vencida" },
];

const DEFAULT_PAGINATION = { page: 1, limit: 20, total: 0, totalPages: 1 };

// Representación corta de una venta — Sale no tiene ningún identificador
// público/legible equivalente a Ticket.ticketNumber (auditoría confirmada).
// Puramente presentacional: se trunca el mismo `id` que ya viaja para la
// acción "Ver", sin agregar ningún campo nuevo.
function saleShortId(sale) {
  return `#${sale.id.slice(-8).toUpperCase()}`;
}

function FilterPills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id || "ALL"}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? "bg-violet-500/10 text-violet-300"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TableSkeleton() {
  return (
    <tbody className="divide-y divide-white/5">
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i}>
          <td className="px-6 py-4" colSpan={9}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-slate-200">{value}</p>
    </div>
  );
}

// Detalle de sólo lectura de una venta — sin botones administrativos a
// propósito (V1 de Developer es exclusivamente de supervisión: nada de
// confirmar, cancelar, reenviar email ni reembolsar).
function SaleDrawer({ sale, loading, error, onClose }) {
  return (
    <Drawer title={sale ? saleShortId(sale) : "Venta"} onClose={onClose}>
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-white/5" />
          ))}
        </div>
      )}

      {!loading && error && <InlineErrorNotice message="No pudimos cargar esta venta." />}

      {!loading && !error && sale && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <p className="text-xs text-slate-500">Estado</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={STATUS_TONE[sale.status] ?? "neutral"}>{STATUS_LABEL[sale.status] ?? sale.status}</Badge>
                  {sale.needsReconciliation && <Badge tone="danger">Requiere conciliación</Badge>}
                </div>
              </div>
              <InfoRow label="Total" value={formatCurrencyARS(sale.total)} />
              <InfoRow label="Fecha de creación" value={formatDateTime(sale.createdAt)} />
              <InfoRow label="Confirmada" value={sale.confirmedAt ? formatDateTime(sale.confirmedAt) : null} />
              <InfoRow label="Payment ID (Mercado Pago)" value={sale.paymentRef} />
            </div>
            {sale.needsReconciliation && (
              <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                Mercado Pago informó este pago como aprobado, pero PaseCultural no pudo emitir las entradas por falta
                de stock. Requiere conciliación manual.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Organización / Evento</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <InfoRow label="Organización" value={sale.organization.name} />
              <InfoRow label="Evento" value={sale.event.title} />
              <InfoRow
                label="Función"
                value={sale.function ? `${formatDateTime(sale.function.date)}${sale.function.venue ? ` · ${sale.function.venue}` : ""}` : null}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Comprador</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <InfoRow label="Nombre" value={sale.buyer.name} />
              <InfoRow label="Correo" value={sale.buyer.email} />
              <InfoRow label="DNI" value={sale.buyer.document} />
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Items de la compra ({sale.items.length})
            </h4>
            {sale.items.length === 0 ? (
              <p className="text-sm text-slate-500">Sin items registrados.</p>
            ) : (
              <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                {sale.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200">{item.ticketType.name}</span>
                      <span className="text-slate-400">x{item.quantity}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatCurrencyARS(item.unitPrice)} c/u · Subtotal {formatCurrencyARS(item.subtotal)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Entradas generadas ({sale.tickets.length})
            </h4>
            {sale.tickets.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no se generaron entradas para esta venta.</p>
            ) : (
              <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                {sale.tickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-mono text-xs text-slate-300">{ticket.ticketNumber}</span>
                    <span className="text-xs text-slate-500">{ticket.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// Developer → Ventas (V1, sólo lectura) — platform-wide a propósito: no
// reutiliza listSalesOrganizerService (organizer-scoped). Sólo origin:"SALE"
// (las cortesías tienen su propio módulo). Sin acciones: confirmar,
// cancelar, reenviar email, reembolsar quedan explícitamente fuera de esta
// iteración.
export default function DeveloperSales() {
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState("");
  // MP-6 (ver auditoría) — mutuamente excluyente con `status`: la
  // condición server-side ya fuerza status=PENDING (developerSales.service.js),
  // así que elegir un status manual desactiva este filtro y viceversa.
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [page, setPage] = useState(1);

  const [organizations, setOrganizations] = useState([]);
  const [eventOptions, setEventOptions] = useState([]);
  const [eventOptionsLoading, setEventOptionsLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [saleDetail, setSaleDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  // "Gana" siempre la última llamada disparada, nunca la que resuelve
  // primero — mismo patrón ya usado en DeveloperTickets.jsx/DeveloperScanners.jsx.
  const salesRequestIdRef = useRef(0);
  const eventOptionsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const list = await getDeveloperOrganizationOptions(token);
        if (!cancelled) setOrganizations(list ?? []);
      } catch (err) {
        console.error("No se pudieron cargar las organizaciones", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Debounce SÓLO para el buscador — organización/evento/estado disparan
  // fetch inmediato (ver loadSales más abajo, que depende de
  // debouncedSearch, no de search).
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  // Cascada: el combo de Evento sólo tiene sentido con una organización ya
  // elegida — nunca se cargan todos los eventos de la plataforma de una.
  useEffect(() => {
    if (!organizationId) {
      setEventOptions([]);
      setEventOptionsLoading(false);
      return;
    }

    const requestId = ++eventOptionsRequestIdRef.current;
    setEventOptionsLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const events = await getDeveloperEventOptions(token, organizationId);
        if (requestId !== eventOptionsRequestIdRef.current) return;
        setEventOptions(events ?? []);
      } catch (err) {
        console.error("No se pudieron cargar los eventos de la organización", err);
        if (requestId === eventOptionsRequestIdRef.current) setEventOptions([]);
      } finally {
        if (requestId === eventOptionsRequestIdRef.current) setEventOptionsLoading(false);
      }
    })();
  }, [organizationId, getToken]);

  const loadSales = useCallback(async () => {
    const requestId = ++salesRequestIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const result = await listDeveloperSales(token, {
        page,
        search: debouncedSearch,
        organizationId: organizationId || undefined,
        eventId: eventId || undefined,
        status: status || undefined,
        needsReconciliation: needsReconciliation || undefined,
      });
      if (requestId !== salesRequestIdRef.current) return;
      setItems(result.items ?? []);
      setPagination(result.pagination ?? DEFAULT_PAGINATION);
    } catch (err) {
      console.error("No se pudieron cargar las ventas", err);
      if (requestId === salesRequestIdRef.current) setError(true);
    } finally {
      if (requestId === salesRequestIdRef.current) setLoading(false);
    }
  }, [getToken, page, debouncedSearch, organizationId, eventId, status, needsReconciliation]);

  // Sin debounce propio acá: organización/evento/estado/página ya llegan
  // resueltos (el único delay es el de `debouncedSearch`, arriba), así que
  // este efecto dispara de inmediato ante cualquier cambio real.
  useEffect(() => {
    loadSales();
  }, [loadSales]);

  useEffect(() => {
    if (!selectedSaleId) return;
    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const token = await getToken();
        const sale = await getDeveloperSale(token, selectedSaleId);
        if (requestId !== detailRequestIdRef.current) return;
        setSaleDetail(sale);
      } catch (err) {
        console.error("No se pudo cargar la venta", err);
        if (requestId === detailRequestIdRef.current) setDetailError(true);
      } finally {
        if (requestId === detailRequestIdRef.current) setDetailLoading(false);
      }
    })();
  }, [selectedSaleId, getToken]);

  // Mutuamente excluyentes (ver estado de arriba): elegir un status manual
  // desactiva "Requiere conciliación" y viceversa.
  function handleStatusChange(value) {
    setStatus(value);
    setNeedsReconciliation(false);
    setPage(1);
  }
  function handleReconciliationToggle() {
    setNeedsReconciliation((prev) => {
      const next = !prev;
      if (next) setStatus("");
      return next;
    });
    setPage(1);
  }

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
  }

  function handleOrganizationChange(value) {
    setOrganizationId(value);
    setEventId(""); // limpiar inmediatamente, antes de que carguen las nuevas opciones
    setPage(1);
  }
  function handleEventChange(value) {
    setEventId(value);
    setPage(1);
  }

  function openSale(id) {
    setSelectedSaleId(id);
    setSaleDetail(null);
    setDetailError(false);
  }
  function closeDrawer() {
    setSelectedSaleId(null);
    setSaleDetail(null);
    setDetailError(false);
  }

  const hasFiltersActive = Boolean(search.trim() || organizationId || eventId || status || needsReconciliation);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Ventas</h1>
        <p className="text-sm text-slate-400">
          Supervisá las ventas de toda la plataforma, de todas las organizaciones.
        </p>
      </div>

      {error && <InlineErrorNotice message="No pudimos cargar las ventas." onRetry={loadSales} />}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
              placeholder="Buscar por comprador, correo o DNI"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <label className="flex min-w-[220px] flex-col gap-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wide text-slate-500">Organización</span>
            <select
              value={organizationId}
              onChange={(e) => handleOrganizationChange(e.target.value)}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
            >
              <option value="">Todas las organizaciones</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[220px] flex-col gap-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
            <select
              value={eventId}
              onChange={(e) => handleEventChange(e.target.value)}
              disabled={!organizationId || eventOptionsLoading}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{organizationId ? "Todos los eventos" : "Elegí una organización primero"}</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</p>
          <FilterPills options={STATUS_FILTERS} value={status} onChange={handleStatusChange} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros especiales</p>
          <button
            type="button"
            aria-pressed={needsReconciliation}
            onClick={handleReconciliationToggle}
            title="Pagos aprobados por Mercado Pago que no pudieron confirmarse por falta de stock"
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
              needsReconciliation
                ? "bg-rose-500/10 text-rose-300"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            Requiere conciliación
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Venta</th>
                <th className="px-6 py-3 font-medium">Organización</th>
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Comprador</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Entradas</th>
                <th className="px-6 py-3 font-medium">Total</th>
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium text-right">Ver</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton />
            ) : (
              <tbody className="divide-y divide-white/5">
                {items.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-6 py-4 font-mono text-xs text-slate-300">{saleShortId(sale)}</td>
                    <td className="max-w-[160px] truncate px-6 py-4 text-slate-300">{sale.organization.name}</td>
                    <td className="max-w-[180px] truncate px-6 py-4 text-slate-300">{sale.event.title}</td>
                    <td className="max-w-[160px] truncate px-6 py-4 text-slate-300">{sale.buyer.name ?? "Sin nombre"}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATUS_TONE[sale.status] ?? "neutral"}>{STATUS_LABEL[sale.status] ?? sale.status}</Badge>
                        {sale.needsReconciliation && (
                          <Badge tone="danger" title="Pago aprobado por Mercado Pago sin stock para confirmar la venta">
                            Conciliación
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{sale.ticketsCount}</td>
                    <td className="px-6 py-4 text-slate-300">{formatCurrencyARS(sale.total)}</td>
                    <td className="px-6 py-4 text-slate-400">{formatDateTime(sale.createdAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openSale(sale.id)}
                        title="Ver"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className="px-6 py-12" colSpan={9}>
                      <EmptyState icon={Receipt}>
                        {hasFiltersActive
                          ? "No encontramos ventas con esos filtros."
                          : "Todavía no se registró ninguna venta en la plataforma."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={pagination.page <= 1}
          className="rounded-lg px-3 py-2 font-medium transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Anterior
        </button>
        <span>
          Página {pagination.page} de {pagination.totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
          disabled={pagination.page >= pagination.totalPages}
          className="rounded-lg px-3 py-2 font-medium transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Siguiente
        </button>
      </div>

      {selectedSaleId && (
        <SaleDrawer sale={saleDetail} loading={detailLoading} error={detailError} onClose={closeDrawer} />
      )}
    </div>
  );
}
