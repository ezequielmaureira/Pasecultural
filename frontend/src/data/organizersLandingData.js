import {
  Ticket,
  LayoutGrid,
  BarChart3,
  Users,
  Building2,
  CalendarPlus,
  Smartphone,
  DollarSign,
  Lock,
  Zap,
  Headset,
} from "lucide-react";

export const ORGANIZER_FEATURES = [
  {
    icon: Ticket,
    iconClass: "bg-violet-500/15 text-violet-400",
    title: "Vendé entradas en minutos",
    description:
      "Creá tu evento, definí el precio y empezá a vender en pocos pasos. Publicación inmediata.",
  },
  {
    icon: LayoutGrid,
    iconClass: "bg-rose-500/15 text-rose-400",
    title: "Escaneo con QR",
    description:
      "Validá entradas desde cualquier dispositivo móvil. Rápido, seguro y sin complicaciones.",
  },
  {
    icon: BarChart3,
    iconClass: "bg-emerald-500/15 text-emerald-400",
    title: "Estadísticas en tiempo real",
    description:
      "Seguí tus ventas, asistentes y recaudación al instante con reportes claros y simples.",
  },
  {
    icon: Users,
    iconClass: "bg-blue-500/15 text-blue-400",
    title: "Gestioná tu equipo",
    description:
      "Invitá a tu equipo de trabajo y asigná roles. Organizadores, scanners y más.",
  },
];

export const ORGANIZER_STEPS = [
  {
    icon: Building2,
    title: "1. Creá tu organización",
    description: "Registrate gratis y creá tu organización en PaseCultural.",
  },
  {
    icon: CalendarPlus,
    title: "2. Publicá un evento",
    description:
      "Completá la información de tu evento, fechas, precios y cupos.",
  },
  {
    icon: Ticket,
    title: "3. Vendé entradas",
    description: "Compartí tu evento y empezá a vender entradas online.",
  },
  {
    icon: Smartphone,
    title: "4. Escaneá y listo",
    description:
      "Validá entradas con QR en el acceso y disfrutá el evento.",
  },
];

export const ORGANIZER_TRUST_FEATURES = [
  {
    icon: DollarSign,
    title: "Sin costos fijos",
    subtitle: "Pagás solo comisión por venta.",
  },
  {
    icon: Lock,
    title: "Cobros seguros",
    subtitle: "Procesamos pagos de forma segura y confiable.",
  },
  {
    icon: Zap,
    title: "Publicación inmediata",
    subtitle: "Tu evento online en minutos, sin demoras.",
  },
  {
    icon: Headset,
    title: "Soporte siempre disponible",
    subtitle: "Estamos para ayudarte en cada paso del camino.",
  },
];

export const DASHBOARD_PREVIEW_STATS = [
  { label: "Ventas totales", value: "$ 4.250.800", delta: "+18% vs mes anterior" },
  { label: "Entradas vendidas", value: "1.256", delta: "+23% vs mes anterior" },
  { label: "Eventos activos", value: "8", delta: "+2 vs mes anterior" },
];

export const DASHBOARD_PREVIEW_EVENTS = [
  { name: "Concierto de Rock", meta: "24 May · 21:00 hs" },
  { name: "Obra de Teatro", meta: "25 May · 20:30 hs" },
  { name: "Festival Indie BA", meta: "1 Jun · 14:00 hs" },
];
