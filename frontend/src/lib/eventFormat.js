export function formatEventDate(iso) {
  if (!iso) return "Fecha a confirmar";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatEventDateTime(iso) {
  if (!iso) return "Fecha a confirmar";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEventLocation(event) {
  return (
    [event.venue, event.city].filter(Boolean).join(", ") || "Lugar a confirmar"
  );
}

export function formatEventPrice(event) {
  return event.isFree ? "Gratis" : "Entrada paga";
}
