// Única traducción de Ticket.origin/Sale.origin (enum SaleOrigin del
// backend) a algo mostrable — organizador (desglose de "Entradas emitidas")
// y Scanner (canal de la entrada escaneada) comparten este mismo mapa, así
// nunca hay dos textos distintos para el mismo origen en dos pantallas.
//
// Un origen nuevo (STAFF, PRESS, VIP, BACKSTAGE, ACCREDITATION, INVITATION)
// que todavía no tiene entrada acá igual se muestra — fallback genérico a
// partir del nombre del enum, nunca desaparece ni rompe. Agregar el origen
// al enum del backend (schema.prisma) alcanza para que aparezca en las
// estadísticas; agregarlo ACÁ es sólo la mejora cosmética opcional (emoji +
// nombre en español) para cuando se implemente ese canal.
const ORIGIN_META = {
  SALE: { emoji: "💰", label: "Venta", pluralLabel: "Vendidas", ticketLabel: "Entrada General" },
  COURTESY: { emoji: "🎁", label: "Cortesía", pluralLabel: "Cortesías", ticketLabel: "Cortesía" },
};

const FALLBACK_EMOJI = "🎫";

function titleCase(origin) {
  return origin.charAt(0) + origin.slice(1).toLowerCase();
}

export function getOriginMeta(origin) {
  const known = ORIGIN_META[origin];
  if (known) return known;
  // Origen desconocido todavía (recién agregado al enum, sin mapa propio):
  // se arma un label legible del nombre técnico en vez de mostrarlo crudo.
  const label = titleCase(origin);
  return { emoji: FALLBACK_EMOJI, label, pluralLabel: label, ticketLabel: label };
}
