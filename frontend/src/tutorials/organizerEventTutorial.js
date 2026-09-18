// Registry de ayudas del tutorial de "Crear evento" (creación tradicional
// web) — mapea stepId REAL del Event Creation Engine
// (backend/src/conversation/steps/definitions.js) a { title, description,
// target }. `target` es el valor de un data-tutorial="..." ya presente en
// ConversationView.jsx/PreviewCard.jsx — nunca un selector CSS frágil.
//
// SOLO cubre los stepId alcanzables por la creación tradicional WEB (ver
// FIRST_STEP_ID="NAME" en el motor). Deliberadamente NO incluye:
//   - EVENT_CREATION_TYPE (exclusivo del arranque de WhatsApp)
//   - WANTS_FREE_TICKETS / FREE_TICKET_QUANTITY (dead/compat-only, ningún
//     next() del motor apunta a ellos)
//   - FEST_PASS_VIDEO_CHOICE / FEST_PASS_VIDEO_UPLOAD (exclusivos de Fest
//     Pass/WhatsApp — quickPassEnabled nunca lo activa este flujo)
//
// `videoUrl`/`voiceText`/`mediaType` — preparado para un futuro video por
// paso (no implementado todavía, ver `TutorialCallout.jsx`): siempre null
// hoy, el componente ya sabe ignorarlos si vienen vacíos.
function step(title, description) {
  return { title, description, videoUrl: null, voiceText: null, mediaType: null };
}

// Target genérico para casi todas las preguntas: el bloque completo
// (pregunta + input/opciones + acción de continuar), marcado en
// ConversationView.jsx como data-tutorial="event-question".
const QUESTION_TARGET = "event-question";

export const ORGANIZER_EVENT_TUTORIAL_STEPS = {
  NAME: { ...step("Nombre del evento", "Elegí un nombre claro y reconocible para tu evento."), target: QUESTION_TARGET },
  DESCRIPTION: {
    ...step("Descripción", "Contá de qué se trata: esto es lo primero que va a leer quien visite tu evento."),
    target: QUESTION_TARGET,
  },
  CATEGORY: { ...step("Categoría", "Elegí la categoría que mejor describe tu evento."), target: QUESTION_TARGET },
  CUSTOM_CATEGORY: {
    ...step("Categoría personalizada", "Ya que elegiste \"Otro\", escribí la categoría que mejor lo describe."),
    target: QUESTION_TARGET,
  },
  COVER_IMAGE: {
    ...step("Imagen de portada", "Subí una imagen atractiva: es lo primero que se ve en el marketplace."),
    target: QUESTION_TARGET,
  },
  LOCATION: {
    ...step("Ubicación", "Indicá dónde va a ser el evento para que tu público pueda encontrarlo."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_MODE: {
    ...step("Funciones", "Elegí si tu evento tiene una única fecha o se repite varias veces."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_SINGLE_CARD: {
    ...step("Fecha y horario", "Completá la fecha y el horario de tu evento."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_RANGE: {
    ...step("Rango de fechas", "Definí entre qué fechas se va a repetir tu evento."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_WEEKDAYS: {
    ...step("Días de la semana", "Elegí en qué días de la semana se repite tu evento."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_RECURRING_SCHEDULES: {
    ...step("Horarios", "Definí el horario de cada función recurrente."),
    target: QUESTION_TARGET,
  },
  FUNCTIONS_LIST: {
    ...step("Revisá las funciones", "Estas son las funciones que se van a crear para tu evento."),
    target: QUESTION_TARGET,
  },
  EVENT_PRICING_TYPE: {
    ...step("Tipo de entrada", "Elegí si tu evento es gratuito o tiene entradas pagas."),
    target: QUESTION_TARGET,
  },
  TICKET_NAME: { ...step("Nombre de la entrada", "Elegí cómo se va a llamar este tipo de entrada."), target: QUESTION_TARGET },
  TICKET_NAME_CUSTOM: {
    ...step("Nombre personalizado", "Escribí el nombre de esta entrada."),
    target: QUESTION_TARGET,
  },
  TICKET_PRICE: { ...step("Precio", "Definí el precio de esta entrada."), target: QUESTION_TARGET },
  TICKET_QUANTITY: { ...step("Cantidad disponible", "Indicá cuántas entradas de este tipo vas a vender."), target: QUESTION_TARGET },
  ADD_ANOTHER_TICKET: {
    ...step("¿Otro tipo de entrada?", "Podés agregar más tipos de entrada o continuar."),
    target: QUESTION_TARGET,
  },
  PROMO_VIDEO_ASK: {
    ...step("Video promocional", "Opcional: sumá un video para mostrar mejor tu evento."),
    target: QUESTION_TARGET,
  },
  PROMO_VIDEO_URL: {
    ...step("Link del video", "Pegá el link de YouTube de tu video promocional."),
    target: QUESTION_TARGET,
  },
  SOCIAL_LINKS_ASK: {
    ...step("Redes sociales", "Opcional: sumá los links de tus redes para que te encuentren."),
    target: QUESTION_TARGET,
  },
  SOCIAL_NETWORK: { ...step("Red social", "Elegí qué red social querés agregar."), target: QUESTION_TARGET },
  SOCIAL_URL: { ...step("Link de la red", "Pegá el link de tu perfil."), target: QUESTION_TARGET },
  ADD_ANOTHER_SOCIAL: {
    ...step("¿Otra red social?", "Podés agregar otra red o continuar."),
    target: QUESTION_TARGET,
  },
};

// Orden REAL del flujo web (ver auditoría del motor) — usado sólo para el
// contador "n/total" del tutorial, nunca para decidir navegación (eso lo
// sigue haciendo exclusivamente el Event Creation Engine).
export const ORGANIZER_EVENT_TUTORIAL_ORDER = Object.keys(ORGANIZER_EVENT_TUTORIAL_STEPS);

// prompt.type === "PREVIEW" — dos micro-pasos sobre la MISMA pantalla:
// primero una explicación general de la card, después el botón Publicar.
// Nunca tapan Editar/Guardar borrador/Publicar (ver TutorialSpotlight).
export const ORGANIZER_EVENT_TUTORIAL_PREVIEW_OVERVIEW = {
  ...step("Revisá tu evento", "Antes de guardar o publicar, verificá que los datos, funciones y entradas estén correctos."),
  target: "event-preview",
};

export const ORGANIZER_EVENT_TUTORIAL_PREVIEW_PUBLISH = {
  ...step("Publicar evento", "Cuando estés conforme, publicalo para que aparezca en Smarticket."),
  target: "event-publish",
};

// Llamada única (primera vez que tiene sentido, ver sessionStorage flag en
// ConversationView.jsx) sobre el navegador de secciones.
export const ORGANIZER_EVENT_TUTORIAL_SECTIONS_NAV = {
  ...step("Podés volver atrás", "Desde acá podés editar una sección que ya completaste."),
  target: "event-sections",
};
