import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Clock3, DollarSign, Ticket, ScanLine, Gauge, CalendarDays, Receipt } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import TextLink from "../../components/ui/TextLink.jsx";
import KpiRow from "../../components/organizer/KpiRow.jsx";
import KpiCard from "../../components/organizer/KpiCard.jsx";
import EventHeroCard from "../../components/organizer/EventHeroCard.jsx";
import EventStatusCard from "../../components/organizer/EventStatusCard.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import SectionHeader from "../../components/organizer/SectionHeader.jsx";
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
      <Clock3 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">{banner.title}</p>
        <p className="mt-1 text-xs opacity-90">{banner.description}</p>
      </div>
    </div>
  );
}

// Skeleton compuesto (imagen + líneas + botón) en vez de un único rectángulo
// pulsando: se percibe más rápido y ya anticipa la forma real de la card más
// importante de la pantalla.
function EventHeroSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0B1120]">
      <div className="flex flex-col md:flex-row">
        <SkeletonBlock className="h-36 w-full shrink-0 sm:h-44 md:h-auto md:w-64" />
        <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
          <SkeletonBlock className="h-5 w-32 rounded-full" />
          <SkeletonBlock className="h-8 w-2/3" />
          <SkeletonBlock className="h-4 w-1/2" />
          <SkeletonBlock className="h-10 w-44 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function OrganizerDashboard() {
  const {
    events,
    loadingEvents,
    eventsError,
    reloadEvents,
    sales,
    loadingSales,
    salesError,
    reloadSales,
    tickets,
    loadingTickets,
    ticketsError,
    reloadTickets,
  } = useOrganizerData();

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

  const hasLoadError = eventsError || salesError || ticketsError;
  function retryFailedLoads() {
    if (eventsError) reloadEvents();
    if (salesError) reloadSales();
    if (ticketsError) reloadTickets();
  }

  return (
    // gap-8/10 (antes gap-6 parejo en todo): más aire entre secciones para
    // que la pantalla "respire" y no se lea como una grilla continua de
    // bloques iguales — ver auditoría de la Iteración 0.5.
    <div className="flex flex-col gap-8 lg:gap-10">
      <div className="flex flex-col gap-4">
        <OrganizationStatusBanner />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Panel del organizador</h1>
          <p className="mt-1 text-sm text-slate-400">Centro de control de tus eventos</p>
        </div>
      </div>

      {hasLoadError && (
        <InlineErrorNotice
          message="No pudimos cargar toda la información del panel. Algunos datos pueden faltar."
          onRetry={retryFailedLoads}
        />
      )}

      {/* 1) Próximo evento / evento en curso — siempre lo primero que se ve,
             y el elemento visualmente más grande de la pantalla. */}
      {loadingEvents ? (
        <EventHeroSkeleton />
      ) : (
        <EventHeroCard
          event={featured?.event ?? null}
          eventFunction={featured?.eventFunction ?? null}
          isOngoing={featured?.isOngoing ?? false}
          sold={featuredSold}
          capacity={featuredCapacity}
        />
      )}

      {/* 2) Resumen general — importante, pero deliberadamente más chico y
             sobrio que la card de arriba. */}
      <div>
        <SectionHeader title="Resumen general" />
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
      </div>

      {/* 3) Estado de mis eventos. */}
      <div>
        <SectionHeader
          icon={CalendarDays}
          title="Estado de mis eventos"
          action={<TextLink to="/organizador/eventos">Ver todos</TextLink>}
        />

        {loadingEvents ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : activeEvents.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarDays} title="Todavía no tenés eventos publicados">
              Cuando publiques un evento, vas a poder ver acá su estado de ventas y ocupación.
            </EmptyState>
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
      <div>
        <SectionHeader
          icon={Receipt}
          title="Últimas ventas"
          action={<TextLink to="/organizador/ventas">Ver todas</TextLink>}
        />
        <Card>
          <SalesTable sales={recentSales} loading={loadingSales} />
        </Card>
      </div>
    </div>
  );
}
