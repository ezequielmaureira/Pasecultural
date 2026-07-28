// Encabezado puramente cosmético: no decide navegación, sólo le da al
// usuario una idea de en qué sección está a partir del stepId que ya vino
// del backend. Si el backend agrega pasos nuevos, en el peor caso esta
// barra se ve un poco desalineada — nunca bloquea ni redirige nada.
const SECTIONS = [
  { label: "Detalles del evento", steps: ["NAME", "DESCRIPTION", "CATEGORY", "CUSTOM_CATEGORY"] },
  { label: "Imagen", steps: ["COVER_IMAGE"] },
  { label: "Ubicación", steps: ["LOCATION"] },
  {
    label: "Funciones",
    steps: [
      "FUNCTIONS_MODE",
      "FUNCTIONS_SINGLE_CARD",
      "FUNCTIONS_RANGE",
      "FUNCTIONS_WEEKDAYS",
      "FUNCTIONS_RECURRING_TIME",
      "FUNCTIONS_LIST",
      "FUNCTIONS_SUMMARY",
    ],
  },
  {
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
  { label: "Video promocional", steps: ["PROMO_VIDEO_ASK", "PROMO_VIDEO_URL"] },
  {
    label: "Redes sociales",
    steps: ["SOCIAL_LINKS_ASK", "SOCIAL_NETWORK", "SOCIAL_URL", "ADD_ANOTHER_SOCIAL"],
  },
  { label: "Vista previa", steps: ["PREVIEW"] },
];

function sectionIndexFor(stepId) {
  const index = SECTIONS.findIndex((section) => section.steps.includes(stepId));
  return index === -1 ? 0 : index;
}

export default function ProgressHeader({ stepId }) {
  const index = sectionIndexFor(stepId);
  const section = SECTIONS[index];
  const progress = ((index + 1) / SECTIONS.length) * 100;

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {section.label}
      </p>
    </div>
  );
}
