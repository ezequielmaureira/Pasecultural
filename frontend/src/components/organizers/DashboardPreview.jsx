import {
  Ticket,
  LayoutDashboard,
  CalendarDays,
  LineChart,
  ScanLine,
  FileText,
  Settings,
  Bell,
} from "lucide-react";
import Avatar from "../ui/Avatar.jsx";
import {
  DASHBOARD_PREVIEW_STATS,
  DASHBOARD_PREVIEW_EVENTS,
} from "../../data/organizersLandingData.js";

const MINI_NAV = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Eventos", icon: CalendarDays },
  { label: "Entradas", icon: Ticket },
  { label: "Ventas", icon: LineChart },
  { label: "Scanners", icon: ScanLine },
  { label: "Reportes", icon: FileText },
  { label: "Configuración", icon: Settings },
];

const CHART_POINTS = "0,38 20,30 40,34 60,18 80,24 100,10 120,16 140,4";

export default function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0B1120] shadow-2xl shadow-black/40">
      <div className="flex">
        <aside className="hidden w-32 shrink-0 flex-col gap-1 border-r border-white/5 p-3 sm:flex">
          <div className="mb-3 flex items-center gap-1.5 px-1">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Ticket className="h-3 w-3" />
            </div>
            <span className="text-[11px] font-bold text-white">PaseCultural</span>
          </div>
          {MINI_NAV.map(({ label, icon: Icon, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium ${
                active
                  ? "bg-violet-500/10 text-violet-300"
                  : "text-slate-500"
              }`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </aside>

        <div className="flex-1 p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold text-white">Resumen</p>
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-slate-500" />
              <Avatar size="sm" name="Mora Gordón" className="h-6 w-6 text-[9px]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {DASHBOARD_PREVIEW_STATS.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-white/5 bg-white/5 p-2.5"
              >
                <p className="text-[9px] text-slate-500">{stat.label}</p>
                <p className="mt-1 text-xs font-bold text-white">{stat.value}</p>
                <p className="mt-0.5 text-[9px] text-emerald-400">{stat.delta}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-white/5 bg-white/5 p-3">
            <p className="mb-2 text-[9px] text-slate-500">Ventas</p>
            <svg viewBox="0 0 140 40" className="h-14 w-full" preserveAspectRatio="none">
              <polyline
                points={CHART_POINTS}
                fill="none"
                stroke="url(#previewGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id="previewGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#60a5fa" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[9px] text-slate-500">Eventos recientes</p>
            <div className="flex flex-col gap-1.5">
              {DASHBOARD_PREVIEW_EVENTS.map((event) => (
                <div key={event.name} className="flex items-center gap-2">
                  <div className="h-5 w-5 shrink-0 rounded bg-white/10" />
                  <div className="min-w-0">
                    <p className="truncate text-[9px] font-medium text-white">
                      {event.name}
                    </p>
                    <p className="truncate text-[8px] text-slate-500">{event.meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
