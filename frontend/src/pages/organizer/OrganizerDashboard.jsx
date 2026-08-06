import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Clock3, DollarSign, Ticket, ScanLine, Gauge, CalendarDays } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import KpiRow from "../../components/organizer/KpiRow.jsx";
import KpiCard from "../../components/organizer/KpiCard.jsx";
import EventHeroCard from "../../components/organizer/EventHeroCard.jsx";
import EventStatusCard from "../../components/organizer/EventStatusCard.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { apiFetch } from "../../lib/api.js";
import { formatCurrencyARS } from "../../lib/format.js";
import {
  pickFeaturedFunction,
  computeEventCapacity,
  groupTicketsByEvent,
  computeSoldCount,
  buildOrganizerKpis,
} from "./dashboard/dashboardMetrics.js";

const ORG_STATUS_BANNER = {
  PENDING: {
    className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    title: "Tu organización está siendo revisada por un administrador.",
    description:
      "Ya podés editar tu organización, crear eventos en borrador y configurar entradas y scanners. Vas a poder publicar en cuanto la aprueben.",
  },
  REJECTED: {
    className: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    title: "Tu organización fue rechazada",
    description:
      "Revisá los datos de tu organización en Configuración o contactanos para más información.",
  },
  SUSPENDED: {
    className: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    title: "Tu organización está suspendida",
    description: "Contactanos para resolver esta situación.",
  },
};

function OrganizationStatusBanner() {
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        if (!cancelled) setOrganization(org);
      } catch (error) {
        console.error("No se pudo obtener la organización", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (organization?.status === "APPROVED") {
    return (
      <div className="flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
        <span aria-hidden>🟢</span>
        Organización verificada
      </div>
    );
  }

  const banner = organization && ORG_STATUS_BANNER[organization.status];
  if (!banner) return null;

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${banner.className}`}>
      <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{banner.title}</p>
        <p className="mt-1 text-xs opacity-90">{banner.description}</p>
      </div>
    </div>
  );
}

export default function OrganizerDashboard() {
  const { events, loadingEvents, sales, loadingSales, tickets, loadingTickets } = useOrganizerData();

  // Un solo `now` por render (no un timer) alcanza para el MVP: no hay
  // ningún otro dato en esta pantalla que cambie en vivo todavía (ver
  // Iteración 2, actividad reciente, para el caso que sí lo justifica).
  const now = useMemo(() => new Date(), []);

  const featured = useMemo(() => pickFeaturedFunction(events, now), [events, now]);
  const ticketsByEvent = useMemo(() => groupTicketsByEvent(tickets), [tickets]);

  const featuredTickets = featured ? ticketsByEvent.get(featured.event.id) ?? [] : [];
  const featuredSold = computeSoldCount(featuredTickets);
  const featuredCapacity = featured ? computeEventCapacity(featured.event) : 0;

  const kpis = useMemo(() => buildOrganizerKpis({ events, tickets, sales }), [events, tickets, sales]);

  const activeEvents = useMemo(
    () =>
      events
        .filter((e) => e.status === "PUBLISHED")
        .sort((a, b) => new Date(a.startDate ?? 0) - new Date(b.startDate ?? 0))
        .slice(0, 6),
    [events]
  );

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    [sales]
  );

  return (
    <div className="flex flex-col gap-6">
      <OrganizationStatusBanner />

      <div>
        <h1 className="text-xl font-bold text-white">Panel del organizador</h1>
        <p className="text-sm text-slate-400">Centro de control de tus eventos</p>
      </div>

      {/* 1) Próximo evento / evento en curso — siempre lo primero que se ve. */}
      {loadingEvents ? (
        <SkeletonBlock className="h-48 rounded-2xl" />
      ) : (
        <EventHeroCard
          event={featured?.event ?? null}
          eventFunction={featured?.eventFunction ?? null}
          isOngoing={featured?.isOngoing ?? false}
          sold={featuredSold}
          capacity={featuredCapacity}
        />
      )}

      {/* 2) Resumen general — 4 KPIs, siempre datos reales o skeleton. */}
      <KpiRow>
        <KpiCard
          label="Recaudación"
          value={formatCurrencyARS(kpis.revenueTotal)}
          icon={DollarSign}
          loading={loadingSales}
        />
        <KpiCard label="Entradas vendidas" value={kpis.ticketsSold} icon={Ticket} loading={loadingTickets} />
        <KpiCard label="Personas ingresadas" value={kpis.checkedIn} icon={ScanLine} loading={loadingTickets} />
        <KpiCard
          label="Ocupación"
          value={kpis.occupancyPct !== null ? `${kpis.occupancyPct}%` : "—"}
          icon={Gauge}
          loading={loadingTickets || loadingEvents}
        />
      </KpiRow>

      {/* 3) Estado de mis eventos. */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Estado de mis eventos</h2>
          <Link to="/organizador/eventos" className="text-xs font-medium text-violet-400 hover:underline">
            Ver todos
          </Link>
        </div>

        {loadingEvents ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : activeEvents.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarDays}>No tenés eventos publicados todavía.</EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeEvents.map((event) => (
              <EventStatusCard
                key={event.id}
                event={event}
                sold={computeSoldCount(ticketsByEvent.get(event.id) ?? [])}
                capacity={computeEventCapacity(event)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4) Últimas ventas. */}
      <Card title="Últimas ventas">
        <SalesTable sales={recentSales} loading={loadingSales} />
      </Card>
    </div>
  );
}
