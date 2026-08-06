import {
  ShoppingBag,
  ScanLine,
  XCircle,
  RotateCcw,
  RefreshCcw,
  CheckCircle2,
  Trash2,
  UserPlus,
} from "lucide-react";

// Identidad visual por tipo de actividad del Timeline (ícono + tono de
// Badge, mismos tonos ya definidos en components/ui/Badge.jsx — ningún
// color nuevo). `buildActivityFeed` (dashboardMetrics.js) sólo produce el
// `type`; este mapa es lo único que sabe cómo se ve cada uno.
export const ACTIVITY_TYPES = {
  purchase: { icon: ShoppingBag, tone: "success" },
  checkin: { icon: ScanLine, tone: "info" },
  cancel: { icon: XCircle, tone: "danger" },
  reactivate: { icon: RotateCcw, tone: "warning" },
  rehabilitate: { icon: RefreshCcw, tone: "warning" },
  markUsedManual: { icon: CheckCircle2, tone: "neutral" },
  softDelete: { icon: Trash2, tone: "danger" },
  scannerRegistered: { icon: UserPlus, tone: "info" },
};

export const DEFAULT_ACTIVITY_TYPE = { icon: CheckCircle2, tone: "neutral" };
