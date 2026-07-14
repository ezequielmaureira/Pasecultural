import {
  LayoutGrid,
  Music,
  Drama,
  Sparkles,
  Smile,
  Star,
  Trophy,
  Baby,
  Palette,
  MoreHorizontal,
} from "lucide-react";

export const CATEGORIES = [
  { label: "Todos", icon: LayoutGrid },
  { label: "Música", icon: Music },
  { label: "Teatro", icon: Drama },
  { label: "Danza", icon: Sparkles },
  { label: "Comedia", icon: Smile },
  { label: "Festivales", icon: Star },
  { label: "Deportes", icon: Trophy },
  { label: "Infantiles", icon: Baby },
  { label: "Arte", icon: Palette },
  { label: "Más", icon: MoreHorizontal },
];

export const FEATURED_EVENTS = [
  {
    id: "rock-nacional",
    name: "Concierto de Rock Nacional",
    venue: "Estadio Quality Espacio",
    date: "24 May · 21:00 hs",
    price: "$ 25.000",
    tag: "MÚSICA",
    tagClass: "bg-fuchsia-500/90",
  },
  {
    id: "la-funcion-que-sale-mal",
    name: "La función que sale mal",
    venue: "Teatro Metropolitan",
    date: "25 May · 20:30 hs",
    price: "$ 18.000",
    tag: "TEATRO",
    tagClass: "bg-amber-500/90",
  },
  {
    id: "festival-indie-ba",
    name: "Festival Indie BA",
    venue: "Parque de la Ciudad",
    date: "1 Jun · 14:00 hs",
    price: "$ 22.000",
    tag: "FESTIVAL",
    tagClass: "bg-emerald-500/90",
  },
  {
    id: "stand-up-juan-solo",
    name: "Stand Up – Juan Solo",
    venue: "Teatro La Trastienda",
    date: "30 May · 22:30 hs",
    price: "$ 22.000",
    tag: "COMEDIA",
    tagClass: "bg-orange-500/90",
  },
  {
    id: "movimiento-libre",
    name: "Movimiento Libre",
    venue: "Centro Cultural Konex",
    date: "28 May · 19:00 hs",
    price: "$ 14.000",
    tag: "DANZA",
    tagClass: "bg-rose-500/90",
  },
  {
    id: "peppa-pig-el-show",
    name: "Peppa Pig – El Show",
    venue: "Teatro Gran Ronex",
    date: "2 Jun · 15:00 hs",
    price: "$ 9.000",
    tag: "INFANTILES",
    tagClass: "bg-sky-500/90",
  },
];

export const TRUST_FEATURES = [
  {
    icon: "shield",
    title: "Pago 100% seguro",
    subtitle: "Con todos los medios",
  },
  {
    icon: "ticket",
    title: "Entradas al instante",
    subtitle: "QR directo a tu email",
  },
  {
    icon: "user",
    title: "Sin registro obligatorio",
    subtitle: "Compra fácil y rápido",
  },
  {
    icon: "headset",
    title: "Soporte siempre disponible",
    subtitle: "Estamos para ayudarte",
  },
];
