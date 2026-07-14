import {
  Users,
  CalendarDays,
  Ticket,
  DollarSign,
  Circle,
} from "lucide-react";
import Card from "../components/ui/Card.jsx";

const STATS = [
  { label: "Usuarios", value: "128", delta: "+12 este mes", icon: Users },
  { label: "Eventos", value: "24", delta: "+5 este mes", icon: CalendarDays },
  {
    label: "Entradas vendidas",
    value: "1.320",
    delta: "+230 este mes",
    icon: Ticket,
  },
  {
    label: "Ventas",
    value: "$2.450.000",
    delta: "+18% este mes",
    icon: DollarSign,
  },
];

const SALES_POINTS = [
  { day: "Lun", value: 150 },
  { day: "Mar", value: 110 },
  { day: "Mié", value: 125 },
  { day: "Jue", value: 95 },
  { day: "Vie", value: 130 },
  { day: "Sáb", value: 70 },
  { day: "Dom", value: 80 },
];

const TICKET_STATUS = [
  { label: "Vendidas", value: "1.020 (77%)", color: "#7c3aed" },
  { label: "Disponibles", value: "240 (18%)", color: "#a78bfa" },
  { label: "Reservadas", value: "60 (5%)", color: "#ddd6fe" },
];

const UPCOMING_EVENTS = [
  {
    name: "Rock Nacional",
    date: "24/07/2025 - 21:00",
    venue: "Teatro del Libertador",
  },
  {
    name: "Stand Up Comedy",
    date: "25/07/2025 - 20:30",
    venue: "Sala Cultural",
  },
  {
    name: "Festival de Jazz",
    date: "26/07/2025 - 19:00",
    venue: "Centro Cultural",
  },
];

const RECENT_ACTIVITY = [
  { text: "Nueva venta de 2 entradas para Rock Nacional", time: "Hace 5 min" },
  { text: "Usuario Juan Pérez se registró", time: "Hace 18 min" },
  { text: "Scanner Scanner 1 validó una entrada", time: "Hace 25 min" },
  { text: "Nuevo evento creado: Expo Arte 2025", time: "Hace 1 hora" },
];

const CHART_WIDTH = 560;
const CHART_HEIGHT = 200;
const CHART_MAX = 160;

function buildPoints() {
  const step = (CHART_WIDTH - 40) / (SALES_POINTS.length - 1);
  return SALES_POINTS.map((point, index) => ({
    ...point,
    x: 20 + step * index,
    y: CHART_HEIGHT - 30 - (point.value / CHART_MAX) * (CHART_HEIGHT - 60),
  }));
}

export default function DashboardDeveloper() {
  const points = buildPoints();
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Resumen general</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(({ label, value, delta, icon: Icon }) => (
          <Card key={label}>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Icon className="h-4 w-4" />
              {label}
            </div>
            <p className="mt-3 text-2xl font-bold text-white">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{delta}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card title="Ventas últimos 7 días">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="w-full"
            preserveAspectRatio="none"
          >
            {[0, 1, 2, 3].map((i) => (
              <line
                key={i}
                x1="20"
                y1={20 + i * 40}
                x2={CHART_WIDTH - 20}
                y2={20 + i * 40}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
            ))}
            <polyline
              points={polyline}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p) => (
              <circle key={p.day} cx={p.x} cy={p.y} r="3.5" fill="#7c3aed" />
            ))}
          </svg>
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            {SALES_POINTS.map((p) => (
              <span key={p.day}>{p.day}</span>
            ))}
          </div>
        </Card>

        <Card title="Entradas por estado">
          <div className="flex items-center gap-6">
            <div
              className="relative h-28 w-28 shrink-0 rounded-full"
              style={{
                background:
                  "conic-gradient(#7c3aed 0% 77%, #a78bfa 77% 95%, #ddd6fe 95% 100%)",
              }}
            >
              <div className="absolute inset-3 rounded-full bg-[#0B1120]" />
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {TICKET_STATUS.map(({ label, value, color }) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 text-slate-300">{label}</span>
                  <span className="text-slate-500">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Eventos próximos
            </h3>
            <button
              type="button"
              className="text-xs font-medium text-violet-400 hover:underline"
            >
              Ver todos
            </button>
          </div>
          <div className="flex flex-col divide-y divide-white/10">
            {UPCOMING_EVENTS.map((event) => (
              <div
                key={event.name}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white/10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {event.name}
                  </p>
                  <p className="text-xs text-slate-500">{event.date}</p>
                </div>
                <p className="max-w-[140px] shrink-0 truncate text-right text-xs text-slate-500">
                  {event.venue}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Actividad reciente
            </h3>
            <button
              type="button"
              className="text-xs font-medium text-violet-400 hover:underline"
            >
              Ver todas
            </button>
          </div>
          <div className="flex flex-col divide-y divide-white/10">
            {RECENT_ACTIVITY.map((item) => (
              <div
                key={item.text}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-400">
                  <Circle className="h-3.5 w-3.5" />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm text-slate-300">
                  {item.text}
                </p>
                <p className="shrink-0 text-xs text-slate-500">{item.time}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
