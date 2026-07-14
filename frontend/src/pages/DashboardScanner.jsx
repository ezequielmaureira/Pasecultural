import { QrCode, CheckCircle2, Clock, XCircle } from "lucide-react";
import Card from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const STATS = [
  { label: "Validadas hoy", value: "86", icon: CheckCircle2 },
  { label: "Pendientes", value: "134", icon: Clock },
  { label: "Rechazadas", value: "3", icon: XCircle },
];

const RECENT_SCANS = [
  { code: "PC-88213", time: "20:41", status: "Válida" },
  { code: "PC-88212", time: "20:40", status: "Válida" },
  { code: "PC-88211", time: "20:39", status: "Ya usada" },
  { code: "PC-88210", time: "20:37", status: "Válida" },
];

const STATUS_STYLES = {
  Válida: "bg-emerald-500/10 text-emerald-400",
  "Ya usada": "bg-rose-500/10 text-rose-400",
};

export default function DashboardScanner() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Panel del scanner</h1>
        <p className="text-sm text-slate-400">
          Validá entradas del evento asignado
        </p>
      </div>

      <Card>
        <div className="flex flex-col items-center gap-4 py-4 text-center sm:flex-row sm:text-left">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-white/20 text-slate-500">
            <QrCode className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Evento asignado
            </p>
            <p className="mt-1 text-lg font-bold text-white">Rock Nacional</p>
            <p className="text-sm text-slate-400">
              Teatro del Libertador · 24/07/2025 - 21:00
            </p>
          </div>
          <Button size="lg" className="w-full sm:w-auto">
            Escanear entrada
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

      <Card title="Últimas validaciones">
        <div className="flex flex-col divide-y divide-white/10">
          {RECENT_SCANS.map((scan) => (
            <div
              key={scan.code}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <p className="flex-1 font-mono text-sm text-white">
                {scan.code}
              </p>
              <p className="text-xs text-slate-500">{scan.time}</p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[scan.status]}`}
              >
                {scan.status}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
