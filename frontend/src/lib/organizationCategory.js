// Rubro de contenido de la Organization (Organization.organizationCategory)
// — mismo patrón exacto que organizationPlan.js. Distinto de
// organizationTypes.js (OrganizationType = tipo de entidad legal/
// organizativa): esto es el rubro de lo que la organización programa de
// cara al público.
export const ORG_CATEGORY_LABEL = {
  THEATER: "Teatro",
  CINEMA: "Cine",
  MUSIC: "Música",
  SPORTS: "Deportes",
  CULTURE: "Cultura",
  PRODUCER: "Productora",
  OTHER: "Otro",
};

// Opciones para el <select> de edición en Developer > Organizaciones. El
// primer valor ("") representa "Sin categoría" (organizationCategory NULL)
// — se envía como null al backend, nunca como string vacío persistido.
export const ORG_CATEGORY_OPTIONS = [
  { value: "", label: "Sin categoría" },
  { value: "THEATER", label: "Teatro" },
  { value: "CINEMA", label: "Cine" },
  { value: "MUSIC", label: "Música" },
  { value: "SPORTS", label: "Deportes" },
  { value: "CULTURE", label: "Cultura" },
  { value: "PRODUCER", label: "Productora" },
  { value: "OTHER", label: "Otro" },
];
