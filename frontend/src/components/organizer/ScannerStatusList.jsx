import { ScanLine } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";
import { getScannerHealth, SCANNER_LIFECYCLE_LABEL } from "./scannerHealth.js";
import { formatRelativeTime } from "../../lib/format.js";

function scannerPersonLabel(scanner) {
  return [scanner.firstName, scanner.lastName].filter(Boolean).join(" ").trim() || scanner.name;
}

function ScannerStatusRow({ scanner, now }) {
  const health = getScannerHealth(scanner, now);

  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{scannerPersonLabel(scanner)}</p>
          <p className="text-xs text-slate-500">{scanner.gate}</p>
        </div>
        <Badge tone={health.tone}>{health.label}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[11px] text-slate-500">Ingresos</dt>
          <dd className="mt-0.5 text-sm font-semibold text-white">{scanner.checkInsCount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Último acceso</dt>
          <dd className="mt-0.5 text-xs text-slate-300">
            {scanner.lastAccessAt ? formatRelativeTime(scanner.lastAccessAt, now) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Último escaneo</dt>
          <dd className="mt-0.5 text-xs text-slate-300">
            {scanner.lastScanAt ? formatRelativeTime(scanner.lastScanAt, now) : "—"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] text-slate-600">{SCANNER_LIFECYCLE_LABEL[scanner.status] ?? scanner.status}</p>
    </div>
  );
}

// Genérico: recibe scanners con la forma tal cual la devuelve
// GET /api/events/:eventId/scanners (más checkInsCount/lastScanAt, ver
// eventScanner.service.js) — no sabe nada del Dashboard ni del "evento
// destacado", así que sirve igual para una futura pantalla "Evento en Vivo".
export default function ScannerStatusList({
  scanners,
  now,
  loading = false,
  emptyMessage = "Todavía no hay scanners para este evento.",
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  if (scanners.length === 0) {
    return <EmptyState icon={ScanLine}>{emptyMessage}</EmptyState>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {scanners.map((scanner) => (
        <ScannerStatusRow key={scanner.id} scanner={scanner} now={now} />
      ))}
    </div>
  );
}
