// Fuente de verdad backend para las categorías de evento. Es el equivalente
// sin íconos de frontend/src/lib/eventCategories.js — ese archivo sigue
// siendo el que usa hoy el wizard web; este es el que consume el
// EventCreationEngine (y, a futuro, el endpoint GET /api/events/categories
// para que el frontend deje de tener su propia copia hardcodeada).
export const EVENT_CATEGORIES = [
    { id: "MUSICA", label: "Música" },
    { id: "TEATRO", label: "Teatro" },
    { id: "STAND_UP", label: "Stand Up" },
    { id: "CINE", label: "Cine" },
    { id: "ARTE_EXPOSICIONES", label: "Arte y Exposiciones" },
    { id: "LITERATURA", label: "Literatura" },
    { id: "CONFERENCIAS", label: "Conferencias" },
    { id: "CURSOS_TALLERES", label: "Cursos y Talleres" },
    { id: "NEGOCIOS", label: "Negocios" },
    { id: "TECNOLOGIA", label: "Tecnología" },
    { id: "CIENCIA", label: "Ciencia" },
    { id: "GASTRONOMIA", label: "Gastronomía" },
    { id: "CATAS_DEGUSTACIONES", label: "Catas y Degustaciones" },
    { id: "EVENTOS_FAMILIARES", label: "Eventos Familiares" },
    { id: "INFANTILES", label: "Infantiles" },
    { id: "SOLIDARIOS", label: "Solidarios" },
    { id: "DEPORTES", label: "Deportes" },
    { id: "MARATONES", label: "Maratones" },
    { id: "AUTOMOVILISMO", label: "Automovilismo" },
    { id: "MOTOCICLISMO", label: "Motociclismo" },
    { id: "TRADICION_CAMPO", label: "Tradición y Campo" },
    { id: "RELIGIOSOS", label: "Religiosos" },
    { id: "FIESTAS", label: "Fiestas" },
    { id: "FERIAS", label: "Ferias" },
    { id: "TURISMO", label: "Turismo" },
    { id: "BIENESTAR", label: "Bienestar" },
    { id: "YOGA_MEDITACION", label: "Yoga y Meditación" },
    { id: "MASCOTAS", label: "Mascotas" },
    { id: "GAMING", label: "Gaming" },
    { id: "JUEGOS_DE_MESA", label: "Juegos de Mesa" },
    { id: "INSTITUCIONALES", label: "Institucionales" },
    { id: "OTRO", label: "Otro" },
];

export const EVENT_CATEGORY_IDS = new Set(EVENT_CATEGORIES.map((c) => c.id));

export function isValidCategoryId(id) {
    return EVENT_CATEGORY_IDS.has(id);
}

// Redes soportadas en el paso "Redes sociales" del Event Creation Engine.
// El video promocional (YouTube) tiene su propio paso y no pasa por acá.
export const SOCIAL_NETWORKS = [
    { id: "INSTAGRAM", label: "Instagram" },
    { id: "FACEBOOK", label: "Facebook" },
    { id: "TIKTOK", label: "TikTok" },
    { id: "X", label: "X" },
    { id: "YOUTUBE", label: "YouTube" },
    { id: "WEB", label: "Página Web" },
    { id: "WHATSAPP", label: "WhatsApp" },
];

export const SOCIAL_NETWORK_IDS = new Set(SOCIAL_NETWORKS.map((s) => s.id));
