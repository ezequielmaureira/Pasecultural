import {
  LayoutGrid,
  Drama,
  Music,
  Smile,
  Baby,
  Palette,
  Landmark,
  UtensilsCrossed,
  Trophy,
  MoreHorizontal,
} from "lucide-react";

export const EVENT_CATEGORIES = [
  { id: "TEATRO", label: "Teatro", icon: Drama },
  { id: "MUSICA", label: "Música", icon: Music },
  { id: "HUMOR", label: "Humor", icon: Smile },
  { id: "INFANTIL", label: "Infantil", icon: Baby },
  { id: "ARTE", label: "Arte", icon: Palette },
  { id: "CULTURA", label: "Cultura", icon: Landmark },
  { id: "GASTRONOMIA", label: "Gastronomía", icon: UtensilsCrossed },
  { id: "DEPORTES", label: "Deportes", icon: Trophy },
  { id: "OTRO", label: "Otro", icon: MoreHorizontal },
];

export const EVENT_CATEGORY_LABEL = Object.fromEntries(
  EVENT_CATEGORIES.map((c) => [c.id, c.label])
);

export const EVENT_CATEGORY_ICON = Object.fromEntries(
  EVENT_CATEGORIES.map((c) => [c.id, c.icon])
);

export const MARKETPLACE_CATEGORIES = [
  { id: "ALL", label: "Todos", icon: LayoutGrid },
  ...EVENT_CATEGORIES,
];

// Categorías mostradas en el dropdown del Navbar público. Es una lista propia
// (con emoji, pensada para navegación) separada de EVENT_CATEGORIES —que es
// la que usa el wizard de creación de eventos y persiste en la base de datos—
// para no romper esa arquitectura ni forzar categorías nuevas en el modelo de
// datos. Donde ya existe una categoría equivalente en EVENT_CATEGORIES se
// reutiliza el mismo id (Teatro, Música, Arte, Deportes, Otro, Stand Up→HUMOR,
// Infantiles→INFANTIL) para que el filtro funcione de una; el resto navega
// preparado a /eventos?categoria=<id> aunque todavía no haya eventos con ese id.
export const NAVBAR_CATEGORIES = [
  { id: "TEATRO", label: "Teatro", emoji: "🎭" },
  { id: "MUSICA", label: "Música", emoji: "🎵" },
  { id: "HUMOR", label: "Stand Up", emoji: "😂" },
  { id: "INFANTIL", label: "Infantiles", emoji: "👶" },
  { id: "DANZA", label: "Danza", emoji: "💃" },
  { id: "ARTE", label: "Arte", emoji: "🎨" },
  { id: "CONFERENCIAS", label: "Conferencias", emoji: "🎤" },
  { id: "FESTIVALES", label: "Festivales", emoji: "🎪" },
  { id: "CINE", label: "Cine", emoji: "🎬" },
  { id: "FERIAS", label: "Ferias", emoji: "🛍" },
  { id: "TALLERES", label: "Talleres", emoji: "📚" },
  { id: "DEPORTES", label: "Deportes", emoji: "🏆" },
  { id: "OTRO", label: "Otro", emoji: "📦" },
];

// Cuando la categoría es "OTRO", el público ve el nombre personalizado que
// cargó el organizador; la categoría de base de datos sigue siendo "OTRO".
export function getEventCategoryLabel(event) {
  if (!event) return "";
  if (event.category === "OTRO" && event.customCategory?.trim()) {
    return event.customCategory.trim();
  }
  return EVENT_CATEGORY_LABEL[event.category] ?? event.category ?? "";
}
