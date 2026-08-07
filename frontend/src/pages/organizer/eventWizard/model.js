// Timezone oficial de la plataforma (100% Argentina hoy) — mismo offset fijo
// que backend/src/utils/calendarDate.js#PLATFORM_UTC_OFFSET (Argentina no
// usa horario de verano desde 2009, así que un offset constante alcanza).
// No se comparte código con el backend porque son dos proyectos npm
// separados sin paquete común — el offset se declara explícito en ambos
// lugares en vez de asumir la timezone del runtime (navegador o servidor).
const PLATFORM_UTC_OFFSET = "-03:00";

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

// La mayoría de los eventos culturales arrancan de noche: 21hs es un
// default razonable para no obligar a elegir horario en cada función nueva
// (el organizador lo puede cambiar con un click en el TimePicker).
export function createEmptyFunction() {
  return {
    _key: tempId(),
    date: "",
    doorsOpenTime: "",
    startTime: "21:00",
    endTime: "",
    venue: "",
    address: "",
    capacity: "",
    status: "SCHEDULED",
    copiedFromPrevious: false,
    ticketAssignments: [],
  };
}

// Timestamp real (function.date/endAt, ISO UTC) -> { date, time } para
// precargar el DatePicker + TimePicker del editor. Lee siempre la hora de
// pared en PLATFORM_UTC_OFFSET (Argentina), nunca la timezone del
// navegador: si se edita un evento desde un dispositivo configurado en otro
// huso horario, la fecha/hora que se ve y edita tiene que seguir siendo la
// hora real del evento en Argentina, no la hora local de quien lo está
// mirando. El truco (correr el instante 3hs atrás y leer los campos UTC del
// resultado) evita depender de una librería de timezones para un offset
// constante.
export function fromDateTime(iso) {
  if (!iso) return { date: "", time: "" };
  const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000; // -03:00, fijo (sin horario de verano)
  const wallClock = new Date(new Date(iso).getTime() - ARGENTINA_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${wallClock.getUTCFullYear()}-${pad(wallClock.getUTCMonth() + 1)}-${pad(wallClock.getUTCDate())}`,
    time: `${pad(wallClock.getUTCHours())}:${pad(wallClock.getUTCMinutes())}`,
  };
}

// `date` (fecha de calendario, "YYYY-MM-DD") + `time` ("HH:mm") -> timestamp
// real (ISO UTC), interpretando esa hora de pared en PLATFORM_UTC_OFFSET
// (Argentina) explícitamente — nunca la timezone del navegador. Espeja
// backend/src/utils/calendarDate.js#combineCalendarDateTime.
export function toDateTime(date, time) {
  if (!date) return null;
  return new Date(`${date}T${time || "00:00"}:00${PLATFORM_UTC_OFFSET}`).toISOString();
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
