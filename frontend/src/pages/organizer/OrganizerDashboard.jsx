import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Clock3, DollarSign, Ticket, ScanLine, Gauge, CalendarDays, Receipt, Activity, Layers } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import TextLink from "../../components/ui/TextLink.jsx";
import KpiRow from "../../components/organizer/KpiRow.jsx";
import KpiCard from "../../components/organizer/KpiCard.jsx";
import EventHeroCard from "../../components/organizer/EventHeroCard.jsx";
import EventStatusCard from "../../components/organizer/EventStatusCard.jsx";
import EventCategorySelector from "../../components/organizer/EventCategorySelector.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import SectionHeader from "../../components/organizer/SectionHeader.jsx";
import ActivityTimeline from "../../components/organizer/ActivityTimeline.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useActiveEvent } from "../../context/ActiveEventContext.jsx";
import { useSessionStorageState } from "../../hooks/useSessionStorageState.js";
import { apiFetch } from "../../lib/api.js";
import { formatCurrencyARS } from "../../lib/format.js";
import {
  groupEventsByCategory,
  findEventCategoryPosition,
  computeEventCapacity,
  groupTicketsByEvent,
  computeSoldCount,
  buildActivityFeed,
} from "./dashboard/dashboardMetrics.js";
import { buildEventStatsKpis, formatIssuedByOriginHint } from "../../components/organizer/functionStatsSelectors.js";
import { useEventControlRoomData } from "./dashboard/useEventControlRoomData.js";

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
    salesError,
    reloadSales,
    tickets,
    ticketsError,
    reloadTickets,
  } = useOrganizerData();

  // Ya no se memoiza con `[]`: la Fase 4 (polling) y el Timeline (fechas
  // relativas en vivo) necesitan que "ahora" avance en cada re-render, no
  // que quede congelado en el momento del montaje. El cálculo en sí es
  // trivial — recalcularlo en cada render no tiene costo real.
  const now = new Date();

  const categorized = groupEventsByCategory(events, now);

  // Evento Activo compartido (ver ActiveEventContext) — Dashboard, Entradas,
  // Ventas, Scanners y Estado de Funciones leen/escriben el mismo valor.
  const { activeEventId, setActiveEventId } = useActiveEvent();

  // Categoría: se recuerda mientras dure la sesión (sessionStorage). Sin
  // elección explícita todavía (primera carga de la sesión), se prioriza el
  // Evento Activo si ya apunta a algo dentro de alguna categoría — así, si
  // el organizador vino de otra pantalla habiendo elegido un evento ahí, el
  // Dashboard lo respeta en vez de imponer su propia prioridad. Si no hay
  // Evento Activo (o no aparece en ninguna categoría, ej. se archivó),
  // prioriza "en curso" > "próximos" > "finalizados", igual que antes.
  const [storedCategory, setStoredCategory] = useSessionStorageState("organizerDashboard.category", null);
  const activeEventPosition = storedCategory === null ? findEventCategoryPosition(categorized, activeEventId) : null;
  const selectedCategory =
    storedCategory ??
    activeEventPosition?.category ??
    (categorized.ongoing.length > 0 ? "ongoing" : categorized.upcoming.length > 0 ? "upcoming" : "finished");

  // Índice dentro de la categoría — nunca se persiste entre sesiones (sólo
  // la categoría), y se reinicia a 0 cada vez que el organizador cambia de
  // categoría a mano. No puede arrancar en `activeEventPosition.index` como
  // valor inicial de useState: en el primer render `events` todavía no
  // cargó (siempre null), así que se corrige con el efecto de abajo apenas
  // termina de cargar.
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!loadingEvents && storedCategory === null && activeEventPosition) {
      setSelectedIndex(activeEventPosition.index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingEvents]);

  function handleSelectCategory(key) {
    setStoredCategory(key);
    setSelectedIndex(0);
  }

  const activeList = categorized[selectedCategory] ?? [];
  const clampedIndex = activeList.length > 0 ? Math.min(selectedIndex, activeList.length - 1) : 0;
  const featured = activeList[clampedIndex] ?? null;
  const featuredEventId = featured?.event?.id ?? null;
  const featuredIsOngoing = selectedCategory === "ongoing";

  // Cada vez que cambia el evento mostrado acá, se convierte en el Evento
  // Activo para el resto del panel — nunca al revés en este efecto (leer
  // activeEventId ya pasó arriba, una sola vez, como default inicial).
  useEffect(() => {
    if (featuredEventId && featuredEventId !== activeEventId) {
      setActiveEventId(featuredEventId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredEventId]);

  const ticketsByEvent = groupTicketsByEvent(tickets);

  const hasLoadError = eventsError || salesError || ticketsError;
  function retryFailedLoads() {
    if (eventsError) reloadEvents();
    if (salesError) reloadSales();
    if (ticketsError) reloadTickets();
  }

  // "Centro de control" del evento seleccionado — Hero/KPIs/Funciones/
  // Scanners/Timeline/Últimas ventas, TODOS alimentados por el mismo fetch
  // scopeado a `featuredEventId`. El polling (Fase 4) sólo corre cuando la
  // categoría activa es "en curso".
  const controlRoom = useEventControlRoomData(featuredEventId, { enabled: featuredIsOngoing });
  const controlRoomLoading = loadingEvents || controlRoom.loading;

  // KPIs y "Últimas ventas" son del evento seleccionado, no de toda la
  // organización. Mismo selector puro que usa "Estadísticas del evento" en
  // Entradas (functionStatsSelectors.js) sobre el mismo functionStats que ya
  // trae controlRoom — capacidad/emitidas/ocupación dejaron de tallarse a
  // mano sobre `tickets` (eso ya no distinguía venta de cortesía).
  const kpis = buildEventStatsKpis({
    functionStats: controlRoom.functionStats,
    sales: controlRoom.sales,
    functionId: "ALL",
  });
  const recentSales = [...controlRoom.sales]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);

  const activityItems = buildActivityFeed({
    sales: controlRoom.sales,
    tickets: controlRoom.tickets,
    scanners: controlRoom.scanners,
    now,
    limit: 20,
  });

  // "Estado de mis eventos" sigue siendo de TODA la organización a
  // propósito (no cambia con el selector de categoría) — es la vista
  // general, el selector de arriba es la vista de foco en un evento.
  const activeEvents = events
    .filter((e) => e.status === "PUBLISHED")
    .sort((a, b) => new Date(a.startDate ?? 0) - new Date(b.startDate ?? 0))
    .slice(0, 6);

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

      {/* 0) Selector de categoría — decide qué evento alimenta todo lo de
             abajo (Hero/KPIs/Funciones/Scanners/Timeline/Últimas ventas). */}
      {loadingEvents ? (
        <SkeletonBlock className="h-11 w-72 rounded-xl" />
      ) : (
        <EventCategorySelector
          counts={{
            ongoing: categorized.ongoing.length,
            upcoming: categorized.upcoming.length,
            finished: categorized.finished.length,
          }}
          selected={selectedCategory}
          onSelect={handleSelectCategory}
          currentLabel={featured?.event?.title}
          currentIndex={clampedIndex}
          total={activeList.length}
          onPrevious={() => setSelectedIndex((i) => Math.max(0, i - 1))}
          onNext={() => setSelectedIndex((i) => Math.min(activeList.length - 1, i + 1))}
        />
      )}

      {/* 1) Evento seleccionado — siempre lo primero que se ve, y el
             elemento visualmente más grande de la pantalla. */}
      {loadingEvents ? (
        <EventHeroSkeleton />
      ) : (
        <EventHeroCard
          event={featured?.event ?? null}
          eventFunction={featured?.eventFunction ?? null}
          category={selectedCategory}
          sold={kpis.issued}
          capacity={kpis.capacity}
        />
      )}

      {/* 2) Resumen del evento seleccionado. Importante, pero
             deliberadamente más chico y sobrio que la card de arriba.
             Mismos 4 grupos que "Estadísticas del evento" en Entradas
             (Comercial/Emisión/Accesos/Ocupación): Comercial es sólo
             origin=SALE (recaudación, Mercado Pago, balances no se tocan);
             el resto es operativo, todos los orígenes que dan derecho a
             ingresar. */}
      <div className="flex flex-col gap-5">
        <SectionHeader title="Resumen del evento" />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Comercial</p>
          <KpiRow columns={3}>
            <KpiCard
              label="Recaudación"
              value={formatCurrencyARS(kpis.revenue)}
              icon={DollarSign}
              loading={controlRoomLoading}
            />
            <KpiCard label="Entradas vendidas" value={kpis.sold} icon={Ticket} loading={controlRoomLoading} />
            <KpiCard
              label="Ticket promedio"
              value={formatCurrencyARS(kpis.averageTicket)}
              icon={DollarSign}
              loading={controlRoomLoading}
            />
          </KpiRow>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Emisión</p>
          <div className="max-w-xs">
            <KpiCard
              label="Entradas emitidas"
              value={kpis.issued}
              hint={formatIssuedByOriginHint(kpis.issuedByOrigin)}
              icon={Layers}
              loading={controlRoomLoading}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Accesos</p>
          <KpiRow columns={3}>
            <KpiCard label="Ingresadas" value={kpis.checkedIn} icon={ScanLine} loading={controlRoomLoading} />
            <KpiCard label="Pendientes de ingreso" value={kpis.pending} icon={Clock3} loading={controlRoomLoading} />
          </KpiRow>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ocupación</p>
          <KpiRow>
            <KpiCard label="Capacidad total" value={kpis.capacity} icon={Gauge} loading={controlRoomLoading} />
            <KpiCard label="Entradas emitidas" value={kpis.issued} icon={Layers} loading={controlRoomLoading} />
            <KpiCard label="Disponibles" value={kpis.remaining} icon={Ticket} loading={controlRoomLoading} />
            <KpiCard
              label="% de ocupación"
              value={kpis.occupancyPct !== null ? `${kpis.occupancyPct}%` : "—"}
              icon={Gauge}
              loading={controlRoomLoading}
            />
          </KpiRow>
        </div>
      </div>

      {/* 3) Actividad reciente del evento seleccionado. Estado de funciones
             y Estado de scanners se sacaron de acá — viven únicamente en
             sus propios módulos (Estado de Funciones / Scanners) para que
             el Dashboard no duplique contenido de otras pantallas. Sólo
             existe si hay un evento elegido: si no hay ninguno en la
             categoría, el EmptyState de la hero de arriba ya lo explica. */}
      {(loadingEvents || featured) && (
        <>
          {controlRoom.error && (
            <InlineErrorNotice
              message="No pudimos actualizar la información en vivo de este evento."
              onRetry={controlRoom.refetch}
            />
          )}

          <div>
            <SectionHeader icon={Activity} title="Actividad reciente" />
            <Card>
              <ActivityTimeline items={activityItems} now={now} loading={controlRoomLoading} />
            </Card>
          </div>
        </>
      )}

      {/* 6) Estado de mis eventos — org-wide, no cambia con el selector. */}
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

      {/* 7) Últimas ventas — del evento seleccionado. */}
      <div>
        <SectionHeader
          icon={Receipt}
          title="Últimas ventas"
          subtitle="Del evento seleccionado arriba."
          action={<TextLink to="/organizador/ventas">Ver todas</TextLink>}
        />
        <Card>
          <SalesTable sales={recentSales} loading={controlRoomLoading} />
        </Card>
      </div>
    </div>
  );
}
