export const ORGANIZATION_TYPES = [
  { id: "TEATRO", label: "Teatro" },
  { id: "PRODUCTORA", label: "Productora" },
  { id: "CENTRO_CULTURAL", label: "Centro cultural" },
  { id: "MUNICIPALIDAD", label: "Municipalidad" },
  { id: "CLUB", label: "Club" },
  { id: "EMPRESA", label: "Empresa" },
  { id: "INDEPENDIENTE", label: "Independiente" },
  { id: "OTRO", label: "Otro" },
];

export const ORGANIZATION_TYPE_LABEL = ORGANIZATION_TYPES.reduce(
  (acc, { id, label }) => ({ ...acc, [id]: label }),
  {}
);
