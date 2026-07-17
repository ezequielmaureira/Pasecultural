import {
  Camera,
  ThumbsUp,
  Clapperboard,
  PlayCircle,
  Music2,
  Globe,
  MessageCircle,
  Link2,
} from "lucide-react";

// Definición centralizada de los tipos de enlace del evento. Para sumar un
// tipo nuevo alcanza con agregar una entrada acá (no requiere tocar la base
// de datos: EventLink.type es un string libre).
export const EVENT_LINK_TYPES = [
  { id: "INSTAGRAM", label: "Instagram", icon: Camera },
  { id: "FACEBOOK", label: "Facebook", icon: ThumbsUp },
  { id: "TIKTOK", label: "TikTok", icon: Clapperboard },
  { id: "YOUTUBE", label: "YouTube", icon: PlayCircle },
  { id: "SPOTIFY", label: "Spotify", icon: Music2 },
  { id: "WEBSITE", label: "Página Web", icon: Globe },
  { id: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
  { id: "OTHER", label: "Otro", icon: Link2 },
];

export const EVENT_LINK_TYPE_LABEL = Object.fromEntries(
  EVENT_LINK_TYPES.map((t) => [t.id, t.label])
);

export const EVENT_LINK_TYPE_ICON = Object.fromEntries(
  EVENT_LINK_TYPES.map((t) => [t.id, t.icon])
);

export function getEventLinkIcon(type) {
  return EVENT_LINK_TYPE_ICON[type] ?? Link2;
}

export function getEventLinkLabel(type) {
  return EVENT_LINK_TYPE_LABEL[type] ?? type;
}
