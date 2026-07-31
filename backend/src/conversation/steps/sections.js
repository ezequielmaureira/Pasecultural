// Agrupación puramente descriptiva de los pasos en secciones — no participa
// de la navegación (eso lo resuelve EventCreationEngine con GOTO/BACK sobre
// cualquier stepId), sólo declara a qué sección pertenece cada paso para que
// una futura barra de navegación pueda mostrarlas y saber cuáles ya se
// completaron. Agregar un paso nuevo a una sección existente (o crear una
// sección nueva, ej. "Patrocinadores") no requiere tocar el motor.
export const SECTIONS = [
    { id: "INFO", label: "Información", steps: ["NAME", "DESCRIPTION", "CATEGORY", "CUSTOM_CATEGORY"] },
    {
        id: "FECHA",
        label: "Fecha y hora",
        steps: [
            "FUNCTIONS_MODE",
            "FUNCTIONS_SINGLE_CARD",
            "FUNCTIONS_RANGE",
            "FUNCTIONS_WEEKDAYS",
            "FUNCTIONS_RECURRING_SCHEDULES",
            "FUNCTIONS_LIST",
        ],
    },
    { id: "UBICACION", label: "Ubicación", steps: ["LOCATION"] },
    { id: "IMAGEN", label: "Imagen", steps: ["COVER_IMAGE"] },
    {
        id: "ENTRADAS",
        label: "Entradas",
        steps: [
            "EVENT_PRICING_TYPE",
            "WANTS_FREE_TICKETS",
            "FREE_TICKET_QUANTITY",
            "TICKET_NAME",
            "TICKET_NAME_CUSTOM",
            "TICKET_PRICE",
            "TICKET_QUANTITY",
            "ADD_ANOTHER_TICKET",
        ],
    },
    { id: "VIDEO", label: "Video", steps: ["PROMO_VIDEO_ASK", "PROMO_VIDEO_URL"] },
    { id: "REDES", label: "Redes", steps: ["SOCIAL_LINKS_ASK", "SOCIAL_NETWORK", "SOCIAL_URL", "ADD_ANOTHER_SOCIAL"] },
    // PREVIEW es un estado especial del motor (no un StepDefinition más, ver
    // definitions.js), así que esta sección no lista steps propios.
    { id: "PUBLICACION", label: "Publicación", steps: [] },
];

export function getSectionForStep(stepId) {
    return SECTIONS.find((section) => section.steps.includes(stepId)) ?? null;
}
