import { DoorOpen, Crown, Users, Newspaper, ShieldCheck, PenLine } from "lucide-react";

// Paso 2 del asistente: opciones sugeridas + "Otra" para texto libre. Los
// ids son arbitrarios (nunca se persisten) — sólo `label` es lo que
// termina guardado como `gate`.
export const GATE_PRESETS = [
  { id: "main", label: "Puerta principal", icon: DoorOpen },
  { id: "north", label: "Puerta norte", icon: DoorOpen },
  { id: "south", label: "Puerta sur", icon: DoorOpen },
  { id: "vip", label: "Acceso VIP", icon: Crown },
  { id: "backstage", label: "Backstage", icon: Users },
  { id: "press", label: "Prensa", icon: Newspaper },
  { id: "control", label: "Control interno", icon: ShieldCheck },
  { id: "custom", label: "Otra (escribir)", icon: PenLine },
];
