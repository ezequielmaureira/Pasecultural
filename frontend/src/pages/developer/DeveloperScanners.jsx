import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, ScanLine, Eye } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";
import Drawer from "../../components/ui/Drawer.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { formatDateTime } from "../../lib/format.js";
import { CHECKIN_SOURCE_LABEL } from "../organizer/ticketAdminDisplay.js";
import { getDeveloperOrganizationOptions } from "../../lib/developerEventsApi.js";
import { getDeveloperEventOptions } from "../../lib/developerTicketsApi.js";
import { listDeveloperScanners, getDeveloperScanner } from "../../lib/developerScannersApi.js";

// EventScannerStatus — sin mapa reutilizable exportado (STATUS_CONFIG de
// OrganizerScanners.jsx no está exportado); local acá, mismos 4 valores
// reales del enum, mismo criterio de terminología que esa pantalla.
const STATUS_LABEL = { INVITED: "Invitado", ACTIVE: "Activo", DISABLED: "Desactivado", REVOKED: "Revocado" };
const STATUS_TONE = { INVITED: "info", ACTIVE: "success", DISABLED: "neutral", REVOKED: "danger" };

const STATUS_FILTERS = [
  { id: "", label: "Todos" },
  { id: "INVITED", label: "Invitado" },
  { id: "ACTIVE", label: "Activo" },
  { id: "DISABLED", label: "Desactivado" },
  { id: "REVOKED", label: "Revocado" },
];

const DEFAULT_PAGINATION = { page: 1, limit: 20, total: 0, totalPages: 1 };

function FilterPills({ options, value, onChange, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id || "ALL"}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
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

// "Sin registrar todavía" vive en el frontend, no en el backend — mismo
// criterio que scannerPersonLabel en OrganizerScanners.jsx (tampoco
// exportado, así que se replica local en vez de importarse).
function personNameLabel(scanner) {
  return scanner.personName || "Sin registrar todavía";
}

// Detalle de sólo lectura de un scanner — sin botones administrativos a
// propósito (V1 de Developer es exclusivamente de observación).
function ScannerDrawer({ scanner, loading, error, onClose }) {
  return (
    <Drawer title={scanner ? personNameLabel(scanner) : "Scanner"} onClose={onClose}>
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-white/5" />
          ))}
        </div>
      )}

      {!loading && error && <InlineErrorNotice message="No pudimos cargar este scanner." />}

      {!loading && !error && scanner && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Identidad</p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
              <Badge tone={STATUS_TONE[scanner.status] ?? "neutral"}>{STATUS_LABEL[scanner.status] ?? scanner.status}</Badge>
              <span className="text-sm text-slate-400">{scanner.internalName}</span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Asignación</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <InfoRow label="Organización" value={scanner.organization.name} />
              <InfoRow label="Evento" value={scanner.event.title} />
              <InfoRow label="Puerta" value={scanner.gate} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Contacto</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <InfoRow label="Correo" value={scanner.contact.email} />
              <InfoRow label="Teléfono" value={scanner.contact.phone} />
              <InfoRow label="DNI" value={scanner.contact.document} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Actividad</p>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <InfoRow label="Invitado" value={formatDateTime(scanner.createdAt)} />
              <InfoRow label="Registrado" value={scanner.claimedAt ? formatDateTime(scanner.claimedAt) : null} />
              <InfoRow label="Activado" value={scanner.activatedAt ? formatDateTime(scanner.activatedAt) : null} />
              <InfoRow label="Último acceso" value={scanner.lastAccessAt ? formatDateTime(scanner.lastAccessAt) : "Nunca"} />
              <InfoRow label="Último dispositivo" value={scanner.lastDevice} />
              <InfoRow label="Escaneos" value={String(scanner.checkInsCount)} />
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Historial reciente ({scanner.checkIns.length})
            </h4>
            {scanner.checkIns.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no escaneó ninguna entrada.</p>
            ) : (
              <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                {scanner.checkIns.map((checkIn) => (
                  <div key={checkIn.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200">{formatDateTime(checkIn.scannedAt)}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                        {CHECKIN_SOURCE_LABEL[checkIn.source] ?? checkIn.source}
                      </span>
                    </div>
                    {checkIn.gate && <p className="text-xs text-slate-500">{checkIn.gate}</p>}
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

// Developer → Scanners (V1, sólo lectura) — platform-wide a propósito: no
// reutiliza eventScanner.service.js (organizer-scoped). Sin acciones:
// desactivar, reactivar, revocar, regenerar, editar, eliminar quedan
// explícitamente fuera de esta iteración.
export default function DeveloperScanners() {
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const [organizations, setOrganizations] = useState([]);
  const [eventOptions, setEventOptions] = useState([]);
  const [eventOptionsLoading, setEventOptionsLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selectedScannerId, setSelectedScannerId] = useState(null);
  const [scannerDetail, setScannerDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  // "Gana" siempre la última llamada disparada, nunca la que resuelve
  // primero — mismo patrón ya usado en DeveloperTickets.jsx.
  const scannersRequestIdRef = useRef(0);
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
  // fetch inmediato (ver loadScanners más abajo, que depende de
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

  const loadScanners = useCallback(async () => {
    const requestId = ++scannersRequestIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const result = await listDeveloperScanners(token, {
        page,
        search: debouncedSearch,
        organizationId: organizationId || undefined,
        eventId: eventId || undefined,
        status: status || undefined,
      });
      if (requestId !== scannersRequestIdRef.current) return;
      setItems(result.items ?? []);
      setPagination(result.pagination ?? DEFAULT_PAGINATION);
    } catch (err) {
      console.error("No se pudieron cargar los scanners", err);
      if (requestId === scannersRequestIdRef.current) setError(true);
    } finally {
      if (requestId === scannersRequestIdRef.current) setLoading(false);
    }
  }, [getToken, page, debouncedSearch, organizationId, eventId, status]);

  // Sin debounce propio acá: organización/evento/estado/página ya llegan
  // resueltos (el único delay es el de `debouncedSearch`, arriba), así que
  // este efecto dispara de inmediato ante cualquier cambio real.
  useEffect(() => {
    loadScanners();
  }, [loadScanners]);

  useEffect(() => {
    if (!selectedScannerId) return;
    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const token = await getToken();
        const scanner = await getDeveloperScanner(token, selectedScannerId);
        if (requestId !== detailRequestIdRef.current) return;
        setScannerDetail(scanner);
      } catch (err) {
        console.error("No se pudo cargar el scanner", err);
        if (requestId === detailRequestIdRef.current) setDetailError(true);
      } finally {
        if (requestId === detailRequestIdRef.current) setDetailLoading(false);
      }
    })();
  }, [selectedScannerId, getToken]);

  function updateFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }
  const handleStatusChange = updateFilter(setStatus);

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

  function openScanner(id) {
    setSelectedScannerId(id);
    setScannerDetail(null);
    setDetailError(false);
  }
  function closeDrawer() {
    setSelectedScannerId(null);
    setScannerDetail(null);
    setDetailError(false);
  }

  const hasFiltersActive = Boolean(search.trim() || organizationId || eventId || status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Scanners</h1>
        <p className="text-sm text-slate-400">
          Supervisá los scanners de toda la plataforma, de todas las organizaciones.
        </p>
      </div>

      {error && <InlineErrorNotice message="No pudimos cargar los scanners." onRetry={loadScanners} />}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
              placeholder="Buscar por nombre o correo"
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
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Scanner</th>
                <th className="px-6 py-3 font-medium">Organización</th>
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Puerta</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Último acceso</th>
                <th className="px-6 py-3 font-medium">Último escaneo</th>
                <th className="px-6 py-3 font-medium">Escaneos</th>
                <th className="px-6 py-3 font-medium text-right">Ver</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton />
            ) : (
              <tbody className="divide-y divide-white/5">
                {items.map((scanner) => (
                  <tr key={scanner.id}>
                    <td className="max-w-[180px] truncate px-6 py-4 text-slate-300">{personNameLabel(scanner)}</td>
                    <td className="max-w-[160px] truncate px-6 py-4 text-slate-300">{scanner.organization.name}</td>
                    <td className="max-w-[180px] truncate px-6 py-4 text-slate-300">{scanner.event.title}</td>
                    <td className="max-w-[140px] truncate px-6 py-4 text-slate-300">{scanner.gate}</td>
                    <td className="px-6 py-4">
                      <Badge tone={STATUS_TONE[scanner.status] ?? "neutral"}>
                        {STATUS_LABEL[scanner.status] ?? scanner.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {scanner.lastAccessAt ? formatDateTime(scanner.lastAccessAt) : "Nunca"}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {scanner.lastScanAt ? formatDateTime(scanner.lastScanAt) : "Nunca"}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{scanner.checkInsCount}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openScanner(scanner.id)}
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
                      <EmptyState icon={ScanLine}>
                        {hasFiltersActive
                          ? "No encontramos scanners con esos filtros."
                          : "Todavía no se generó ningún scanner en la plataforma."}
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

      {selectedScannerId && (
        <ScannerDrawer scanner={scannerDetail} loading={detailLoading} error={detailError} onClose={closeDrawer} />
      )}
    </div>
  );
}
