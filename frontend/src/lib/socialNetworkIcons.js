import { Camera, ThumbsUp, Clapperboard, AtSign, PlayCircle, Globe, MessageCircle, Link2 } from "lucide-react";

// Íconos para los ids de red que usa el Event Creation Engine
// (backend/src/utils/eventCategories.js -> SOCIAL_NETWORKS). Mismo criterio
// visual que frontend/src/lib/eventLinkTypes.js, pero con los ids nuevos
// (incluye X, que el wizard viejo no tenía).
export const SOCIAL_NETWORK_ICON = {
  INSTAGRAM: Camera,
  FACEBOOK: ThumbsUp,
  TIKTOK: Clapperboard,
  X: AtSign,
  YOUTUBE: PlayCircle,
  WEB: Globe,
  WHATSAPP: MessageCircle,
};

export function getSocialNetworkIcon(networkId) {
  return SOCIAL_NETWORK_ICON[networkId] ?? Link2;
}
