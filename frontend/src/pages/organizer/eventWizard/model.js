let tempIdCounter = 0;
export function tempId() {
  tempIdCounter += 1;
  return `tmp-${Date.now()}-${tempIdCounter}`;
}

export function createEmptyLink() {
  return {
    _key: tempId(),
    url: "",
    title: "",
    // Los siguientes campos los completa MediaParser automáticamente a
    // partir de la URL; el organizador nunca los elige a mano.
    // `type` usa los mismos valores que EventLink.type en la base de datos
    // (INSTAGRAM, YOUTUBE, etc), para que SocialLinks funcione igual acá y
    // en la página pública.
    type: null,
    embedUrl: null,
    thumbnail: null,
    isEmbeddable: false,
    error: undefined,
  };
}

export function createEmptyTicketType() {
  return {
    _key: tempId(),
    name: "",
    price: "",
    quantity: "",
    maxPerPurchase: 10,
    description: "",
    visible: true,
  };
}

export function createDefaultAssignment() {
  return {
    enabled: true,
    useCatalogPrice: true,
    priceOverride: "",
    useCatalogQuantity: true,
    quantityOverride: "",
    useCatalogVisible: true,
    visibleOverride: true,
  };
}

export function createEmptyFunction() {
  return {
    _key: tempId(),
    date: "",
    doorsOpenTime: "",
    startTime: "",
    endTime: "",
    venue: "",
    address: "",
    capacity: "",
    status: "SCHEDULED",
    copiedFromPrevious: false,
    ticketAssignments: [],
  };
}

export function fromDateTime(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function toDateTime(date, time) {
  if (!date) return null;
  return new Date(`${date}T${time || "00:00"}:00`).toISOString();
}

export function currency(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "$0";
  return `$${n.toLocaleString("es-AR")}`;
}

// Alinea las asignaciones de una función con el catálogo vigente: agrega
// asignaciones por defecto para entradas nuevas y descarta las que ya no existen.
export function reconcileAssignments(ticketAssignments, catalog) {
  return catalog.map((_, index) => ticketAssignments[index] ?? createDefaultAssignment());
}

export function effectivePrice(catalogItem, assignment) {
  if (!assignment || assignment.useCatalogPrice) return Number(catalogItem.price) || 0;
  return Number(assignment.priceOverride) || 0;
}

export function effectiveQuantity(catalogItem, assignment) {
  if (!assignment || assignment.useCatalogQuantity) return Number(catalogItem.quantity) || 0;
  return Number(assignment.quantityOverride) || 0;
}

export function effectiveVisible(catalogItem, assignment) {
  if (!assignment || assignment.useCatalogVisible) return Boolean(catalogItem.visible);
  return Boolean(assignment.visibleOverride);
}
