import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  ArrowLeft,
  CalendarDays,
  DollarSign,
  Ticket,
  LogIn,
  Gauge,
  Percent,
  Settings,
  Copy,
} from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import LinkButton from "../../components/ui/LinkButton.jsx";
import TextLink from "../../components/ui/TextLink.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Accordion from "../../components/ui/Accordion.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import EventCoverImage from "../../components/organizer/EventCoverImage.jsx";
import KpiRow from "../../components/organizer/KpiRow.jsx";
import KpiCard from "../../components/organizer/KpiCard.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import ActivityTimeline from "../../components/organizer/ActivityTimeline.jsx";
import { buildEventStatsKpis } from "../../components/organizer/functionStatsSelectors.js";
import { buildActivityFeed } from "./dashboard/dashboardMetrics.js";
import { getArchivedEventSummary, duplicateEvent } from "../../lib/eventArchiveApi.js";
import { eventEditPath } from "../../lib/organizerRoutes.js";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import { EVENT_STATUS_LABEL } from "../../lib/eventStatus.js";
import { EVENT_STATUS_TONE } from "../../components/organizer/eventStatusTone.js";
import { getOriginMeta } from "../../lib/ticketOrigin.js";
import { ticketStatusLabel, ticketStatusBadgeTone } from "./ticketAdminDisplay.js";
import { formatCurrencyARS, formatShortDate, formatDateTime } from "../../lib/format.js";
import { useToast } from "../../context/ToastContext.jsx";

// "Informe final" de solo lectura de UN evento ya archivado — el destino
// principal del Historial de Eventos (ver el informe de la ronda
// "Historial de Eventos completo"). Nunca acciones operativas (cancelar,
// marcar usada, etc.): sólo consulta. Los KPIs/actividad se arman con los
// MISMOS selectores puros que ya usa el Dashboard en vivo
// (functionStatsSelectors.js/dashboardMetrics.js) sobre los datos crudos
// que trae GET /api/events/archived/:eventId/summary — ninguna fórmula
// nueva.

// Mismos labels que ya usa OrganizerScanners.jsx (STATUS_CONFIG, no
// exportado ahí) — duplicado acá a propósito en vez de tocar esa pantalla
// operativa sólo para exportar un mapa de texto.
const SCANNER_STATUS_LABEL = { INVITED: "Invitado", ACTIVE: "Activo", DISABLED: "Desactivado", REVOKED: "Revocado" };

function formatFunctionLabel(fn) {
  const parts = [formatDateTime(fn.date)];
  if (fn.venue) parts.push(fn.venue);
  return parts.join(" · ");
}

function SectionCard({ title, subtitle, children, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Accordion expanded={expanded} onToggle={() => setExpanded((v) => !v)} title={title} subtitle={subtitle}>
      {children}
    </Accordion>
  );
}

export default function OrganizerEventHistoryDetail() {
  const { eventId } = useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const summary = await getArchivedEventSummary(token, eventId);
      setData(summary);
    } catch (err) {
      console.error("No se pudo cargar el resumen histórico del evento", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const kpis = useMemo(() => {
    if (!data) return null;
    const base = buildEventStatsKpis({ functionStats: data.functionStats, sales: data.sales, functionId: "ALL" });
    const attendancePct = base.issued > 0 ? Math.round((base.checkedIn / base.issued) * 1000) / 10 : null;
    return { ...base, attendancePct };
  }, [data]);

  const activityItems = useMemo(() => {
    if (!data) return [];
    return buildActivityFeed({ sales: data.sales, tickets: data.tickets, scanners: data.scanners, now: new Date(), limit: 30 });
  }, [data]);

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const token = await getToken();
      const event = await duplicateEvent(token, eventId);
      toast.success(`Se duplicó como "${event.title}" (borrador).`);
      navigate(eventEditPath(event.id));
    } catch (err) {
      console.error("No se pudo duplicar el evento", err);
      toast.error(err.message || "No se pudo duplicar el evento.");
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <TextLink to="/organizador/historial" className="inline-flex w-fit items-center gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al Historial
      </TextLink>

      {loading && (
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-40 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && <InlineErrorNotice message="No pudimos cargar el resumen histórico de este evento." onRetry={load} />}

      {!loading && !error && data && (
        <>
          {/* Portada — informe final del evento. */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111713]">
            <EventCoverImage src={data.event.coverImage} icon={CalendarDays} className="h-40 w-full" />
            <div className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-bold text-white">{data.event.title}</h1>
                  <p className="mt-1 text-sm text-slate-400">
                    {data.event.venueName || data.event.venue || "Lugar a confirmar"}
                    {data.event.category && ` · ${getEventCategoryLabel(data.event)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={EVENT_STATUS_TONE[data.event.status] ?? "neutral"}>
                    {EVENT_STATUS_LABEL[data.event.status] ?? data.event.status}
                  </Badge>
                  <Badge tone="neutral">Archivado {formatShortDate(data.event.archivedAt)}</Badge>
                </div>
              </div>

              {/* Acciones secundarias — nunca compiten con el informe en sí.
                  No hay "Restaurar": un evento archivado nunca vuelve a
                  Eventos vigentes (ver el informe de la ronda "Retiro de
                  Restaurar Evento") — self-heal lo volvería a archivar en el
                  siguiente listado igual, porque sus funciones ya
                  terminaron. Si el organizador necesita algo parecido,
                  Duplicar crea una edición nueva en DRAFT sin tocar este
                  histórico. */}
              <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
                <LinkButton to={eventEditPath(data.event.id)} variant="ghost" size="sm">
                  <Settings className="h-4 w-4" />
                  Ver configuración del evento
                </LinkButton>
                <Button variant="ghost" size="sm" onClick={handleDuplicate} loading={duplicating} loadingText="Duplicando...">
                  <Copy className="h-4 w-4" />
                  Duplicar evento
                </Button>
              </div>
            </div>
          </div>

          {/* KPIs — mismos cálculos que el Dashboard en vivo
              (buildEventStatsKpis), nunca una fórmula nueva. */}
          <div className="flex flex-col gap-4">
            <KpiRow columns={3}>
              <KpiCard icon={DollarSign} label="Recaudación" value={formatCurrencyARS(kpis.revenue)} />
              <KpiCard icon={Ticket} label="Entradas vendidas" value={kpis.sold} />
              <KpiCard icon={Ticket} label="Entradas emitidas" value={kpis.issued} hint={`${kpis.sold} ventas · ${kpis.issued - kpis.sold} cortesías`} />
            </KpiRow>
            <KpiRow columns={3}>
              <KpiCard icon={LogIn} label="Ingresaron" value={kpis.checkedIn} />
              <KpiCard
                icon={Percent}
                label="Asistencia"
                value={kpis.attendancePct === null ? "—" : `${kpis.attendancePct}%`}
                hint={`${kpis.checkedIn} / ${kpis.issued} emitidas`}
              />
              <KpiCard icon={Gauge} label="Ocupación" value={kpis.occupancyPct === null ? "—" : `${kpis.occupancyPct}%`} hint={`${kpis.capacity} capacidad total`} />
            </KpiRow>
          </div>

          {/* Secciones — todo de solo lectura. */}
          <div className="flex flex-col gap-3">
            <SectionCard title="Funciones" subtitle={`${data.functions.length} en total`} defaultExpanded>
              {data.functions.length === 0 ? (
                <EmptyState icon={CalendarDays}>Este evento no tuvo funciones.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-medium">Función</th>
                        <th className="py-2 pr-3 font-medium">Capacidad</th>
                        <th className="py-2 pr-3 font-medium">Vendidas</th>
                        <th className="py-2 pr-3 font-medium">Emitidas</th>
                        <th className="py-2 pr-3 font-medium">Ingresaron</th>
                        <th className="py-2 pr-3 font-medium">Canceladas</th>
                        <th className="py-2 font-medium">Ocupación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.functions.map((fn) => {
                        const stats = data.functionStats.find((s) => s.functionId === fn.id);
                        const occupancy = stats && stats.capacity > 0 ? Math.round((stats.checkedIn / stats.capacity) * 100) : null;
                        return (
                          <tr key={fn.id}>
                            <td className="py-2.5 pr-3 text-white">
                              {formatFunctionLabel(fn)}
                              {fn.status === "CANCELLED" && (
                                <Badge tone="danger" className="ml-2">
                                  Cancelada
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-300">{stats?.capacity ?? "—"}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{stats?.sold ?? "—"}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{stats?.issued ?? "—"}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{stats?.checkedIn ?? "—"}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{stats?.cancelled ?? "—"}</td>
                            <td className="py-2.5 text-slate-300">{occupancy === null ? "—" : `${occupancy}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Ventas" subtitle={`${data.sales.length} en total`}>
              <SalesTable sales={data.sales} emptyMessage="Este evento no tuvo ventas." />
            </SectionCard>

            <SectionCard title="Entradas" subtitle={`${data.tickets.length} en total`}>
              {data.tickets.length === 0 ? (
                <EmptyState icon={Ticket}>Este evento no emitió entradas.</EmptyState>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="sticky top-0 bg-[#111713]">
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-medium">Número</th>
                        <th className="py-2 pr-3 font-medium">Comprador</th>
                        <th className="py-2 pr-3 font-medium">Tipo</th>
                        <th className="py-2 pr-3 font-medium">Origen</th>
                        <th className="py-2 pr-3 font-medium">Estado</th>
                        <th className="py-2 font-medium">Check-in</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.tickets.map((ticket) => {
                        const origin = getOriginMeta(ticket.origin);
                        const lastCheckIn = ticket.checkIns[0] ?? null;
                        return (
                          <tr key={ticket.id}>
                            <td className="py-2.5 pr-3 font-mono text-xs text-white">{ticket.ticketNumber}</td>
                            <td className="max-w-[180px] truncate py-2.5 pr-3 text-slate-300">
                              {ticket.buyerName || ticket.buyerEmail || "—"}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-300">{ticket.ticketTypeName}</td>
                            <td className="py-2.5 pr-3 text-slate-300">
                              {origin.emoji} {origin.label}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeTone(ticket)}`}>
                                {ticketStatusLabel(ticket)}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-300">
                              {lastCheckIn ? formatDateTime(lastCheckIn.scannedAt) : "No ingresó"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Scanners" subtitle={`${data.scanners.length} utilizados`}>
              {data.scanners.length === 0 ? (
                <EmptyState icon={LogIn}>Este evento no tuvo scanners activados.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-medium">Nombre</th>
                        <th className="py-2 pr-3 font-medium">Puerta</th>
                        <th className="py-2 pr-3 font-medium">Estado final</th>
                        <th className="py-2 pr-3 font-medium">Ingresos</th>
                        <th className="py-2 font-medium">Último ingreso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.scanners.map((scanner) => (
                        <tr key={scanner.id}>
                          <td className="py-2.5 pr-3 text-white">{scanner.name || "—"}</td>
                          <td className="py-2.5 pr-3 text-slate-300">{scanner.gate || "—"}</td>
                          <td className="py-2.5 pr-3 text-slate-300">{SCANNER_STATUS_LABEL[scanner.status] ?? scanner.status}</td>
                          <td className="py-2.5 pr-3 text-slate-300">{scanner.checkInsCount}</td>
                          <td className="py-2.5 text-slate-300">
                            {scanner.lastScanAt ? formatDateTime(scanner.lastScanAt) : "Nunca"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Actividad" subtitle="Lo que se puede reconstruir con los datos guardados">
              <ActivityTimeline items={activityItems} now={new Date()} emptyMessage="No hay actividad registrada para este evento." />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
