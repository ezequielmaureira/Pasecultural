import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  CalendarCheck,
  CalendarClock,
  Clock3,
  Ticket,
  TicketX,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { EVENT_STATUS } from "../../data/organizerMockData.js";
import { apiFetch } from "../../lib/api.js";

const ORG_STATUS_BANNER = {
  PENDING: {
    className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    title: "Tu organización está en revisión",
    description:
      "Ya podés crear eventos en borrador y configurar entradas y scanners. Vas a poder publicar en cuanto un administrador apruebe tu organización.",
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
        const { organization: org } = await apiFetch("/api/organizations/me", {
          token,
        });
        if (!cancelled) setOrganization(org);
      } catch (error) {
        console.error("No se pudo obtener la organización", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

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

const STATUS_STYLES = {
  Válida: "bg-emerald-500/10 text-emerald-400",
  Duplicada: "bg-amber-500/10 text-amber-400",
  Inválida: "bg-rose-500/10 text-rose-400",
  Aprobada: "bg-emerald-500/10 text-emerald-400",
  Pendiente: "bg-amber-500/10 text-amber-400",
  Cancelada: "bg-rose-500/10 text-rose-400",
};

function Pill({ children }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        STATUS_STYLES[children] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {children}
    </span>
  );
}

function currency(value) {
  return `$${Number(value).toLocaleString("es-AR")}`;
}

export default function OrganizerDashboard() {
  const { events, sales, recentScans } = useOrganizerData();

  const activeEvents = events.filter((e) => e.status === EVENT_STATUS.PUBLISHED);
  const finishedEvents = events.filter((e) => e.status === EVENT_STATUS.FINISHED);

  const allTicketTypes = events.flatMap((e) => e.ticketTypes);
  const ticketsSold = allTicketTypes.reduce((sum, tt) => sum + (tt.sold ?? 0), 0);
  const ticketsAvailable = allTicketTypes.reduce(
    (sum, tt) => sum + (tt.stock - (tt.sold ?? 0)),
    0
  );

  const approvedSales = sales.filter((s) => s.status === "Aprobada");
  const totalRevenue = approvedSales.reduce((sum, s) => sum + s.amount, 0);
  const latestMonth = sales
    .reduce((max, s) => (s.date > max ? s.date : max), sales[0]?.date ?? "")
    .slice(0, 7);
  const monthRevenue = approvedSales
    .filter((s) => s.date.slice(0, 7) === latestMonth)
    .reduce((sum, s) => sum + s.amount, 0);

  const STATS = [
    { label: "Eventos activos", value: activeEvents.length, icon: CalendarCheck },
    { label: "Eventos finalizados", value: finishedEvents.length, icon: CalendarClock },
    { label: "Entradas vendidas", value: ticketsSold, icon: Ticket },
    { label: "Entradas disponibles", value: ticketsAvailable, icon: TicketX },
    { label: "Recaudación total", value: currency(totalRevenue), icon: DollarSign },
    { label: "Recaudación del mes", value: currency(monthRevenue), icon: TrendingUp },
  ];

  const upcomingEvents = [...activeEvents]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  const latestSales = [...sales]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <OrganizationStatusBanner />

      <div>
        <h1 className="text-xl font-bold text-white">Panel del organizador</h1>
        <p className="text-sm text-slate-400">
          Gestioná tus eventos y tu equipo de scanners
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATS.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Icon className="h-4 w-4" />
              {label}
            </div>
            <p className="mt-3 text-2xl font-bold text-white">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Próximos eventos</h3>
            <Link
              to="/organizador/eventos"
              className="text-xs font-medium text-violet-400 hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-white/10">
            {upcomingEvents.map((event) => (
              <div key={event.id} className="py-3 first:pt-0 last:pb-0">
                <p className="truncate text-sm font-medium text-white">
                  {event.name}
                </p>
                <p className="text-xs text-slate-500">
                  {event.date} · {event.time}
                </p>
              </div>
            ))}
            {upcomingEvents.length === 0 && (
              <p className="py-3 text-sm text-slate-500">
                No hay eventos publicados.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Últimas ventas</h3>
            <Link
              to="/organizador/ventas"
              className="text-xs font-medium text-violet-400 hover:underline"
            >
              Ver todas
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-white/10">
            {latestSales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {sale.buyer}
                  </p>
                  <p className="text-xs text-slate-500">{sale.event}</p>
                </div>
                <Pill>{sale.status}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Últimos tickets escaneados
            </h3>
            <Link
              to="/organizador/scanners"
              className="text-xs font-medium text-violet-400 hover:underline"
            >
              Ver scanners
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-white/10">
            {recentScans.map((scan) => (
              <div
                key={scan.code}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-white">
                    {scan.code}
                  </p>
                  <p className="text-xs text-slate-500">
                    {scan.event} · {scan.time}
                  </p>
                </div>
                <Pill>{scan.status}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
