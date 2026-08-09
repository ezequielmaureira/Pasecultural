import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { Users, Briefcase, Clock3, CalendarDays, Ticket, DollarSign, ScanLine, Circle } from "lucide-react";
import Card from "../components/ui/Card.jsx";
import SkeletonBlock from "../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { getDeveloperDashboard } from "../lib/developerDashboardApi.js";
import { formatCurrencyARS, formatDateTime, formatRelativeTime } from "../lib/format.js";

// Variante clickeable de KpiCard — KpiCard (components/organizer/KpiCard.jsx)
// es deliberadamente no interactiva ("sin hover propio a propósito"), así
// que en vez de forzarle un modo interactivo que afecte también al resto
// del panel de organizador que ya la usa, ésta es una copia visual mínima
// con `<Link>` como raíz (real, accesible, con foco/hover propios). Local a
// este archivo, no compartida — generalizada a partir de la que antes sólo
// servía para "Organizaciones pendientes", ahora reutilizada por las 7 cards.
function ClickableKpiCard({ to, label, value, icon: Icon, loading }) {
  return (
    <Link
      to={to}
      aria-label={loading ? `${label}: cargando` : `${label}: ${value}. Ver ${label.toLowerCase()}`}
      className="group block min-w-0 rounded-xl border border-white/10 bg-[#0B1120] p-6 transition-colors duration-150 hover:border-violet-500/40 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
    >
      <div className="flex items-center gap-2 text-sm text-slate-400 group-hover:text-slate-300">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <SkeletonBlock className="mt-3 h-7 w-20" />
      ) : (
        <p className="mt-3 truncate text-2xl font-bold text-white">{value}</p>
      )}
    </Link>
  );
}

// Dashboard Developer V1 — panel de control platform-wide, un único fetch
// agregado (GET /api/developer/dashboard, ver developerDashboard.service.js
// en el backend). Sin gráficos, sin deltas mensuales: sólo lo que ese
// endpoint devuelve. Nunca se muestra un dato de ejemplo como fallback si
// falla la carga — error real, con reintento.
export default function DashboardDeveloper() {
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const result = await getDeveloperDashboard(token);
      setData(result);
    } catch (err) {
      console.error("No se pudo cargar el Dashboard Developer", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Igual que OrganizerDashboard.jsx: se recalcula en cada render (sin
  // useMemo) para que los tiempos relativos de "Actividad reciente" no
  // queden congelados en el momento del primer fetch.
  const now = new Date();

  const kpis = data?.kpis ?? null;
  const upcomingEvents = data?.upcomingEvents ?? [];
  const recentActivity = data?.recentActivity ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Resumen general de la plataforma</p>
      </div>

      {error && <InlineErrorNotice message="No pudimos cargar el Dashboard." onRetry={load} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ClickableKpiCard
          to="/developer/usuarios"
          label="Usuarios"
          value={(kpis?.usersTotal ?? 0).toLocaleString("es-AR")}
          icon={Users}
          loading={loading}
        />
        <ClickableKpiCard
          to="/developer/usuarios"
          label="Organizadores"
          value={(kpis?.organizersTotal ?? 0).toLocaleString("es-AR")}
          icon={Briefcase}
          loading={loading}
        />
        <ClickableKpiCard
          to="/developer/organizaciones"
          label="Organizaciones pendientes"
          value={(kpis?.pendingOrganizations ?? 0).toLocaleString("es-AR")}
          icon={Clock3}
          loading={loading}
        />
        <ClickableKpiCard
          to="/developer/eventos"
          label="Eventos publicados"
          value={(kpis?.publishedEvents ?? 0).toLocaleString("es-AR")}
          icon={CalendarDays}
          loading={loading}
        />
        <ClickableKpiCard
          to="/developer/entradas"
          label="Entradas vendidas"
          value={(kpis?.soldTickets ?? 0).toLocaleString("es-AR")}
          icon={Ticket}
          loading={loading}
        />
        {/* "Volumen bruto de ventas" — nunca "Recaudación"/"Ingresos": no
            hay comisión ni cobro real todavía (Mercado Pago no está
            integrado). Ver KPI grossSalesVolume en el backend. */}
        <ClickableKpiCard
          to="/developer/ventas"
          label="Volumen bruto de ventas"
          value={formatCurrencyARS(kpis?.grossSalesVolume ?? 0)}
          icon={DollarSign}
          loading={loading}
        />
        <ClickableKpiCard
          to="/developer/scanners"
          label="Scanners activos"
          value={(kpis?.scannersActive ?? 0).toLocaleString("es-AR")}
          icon={ScanLine}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Eventos próximos">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <EmptyState icon={CalendarDays}>No hay eventos próximos publicados.</EmptyState>
          ) : (
            <div className="flex flex-col divide-y divide-white/10">
              {upcomingEvents.map((event) => (
                <div key={event.eventId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-white/10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{event.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {event.organizationName} · {formatDateTime(event.nextFunctionDate)}
                    </p>
                  </div>
                  {event.venue && (
                    <p className="max-w-[140px] shrink-0 truncate text-right text-xs text-slate-500">
                      {event.venue}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Actividad reciente">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonBlock key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <EmptyState icon={Circle}>Todavía no hay actividad registrada.</EmptyState>
          ) : (
            <div className="flex flex-col divide-y divide-white/10">
              {recentActivity.map((item) => (
                <div
                  key={`${item.type}-${item.entityId}`}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-400">
                    <Circle className="h-3.5 w-3.5" />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm text-slate-300">{item.description}</p>
                  <p className="shrink-0 text-xs text-slate-500">{formatRelativeTime(item.occurredAt, now)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
