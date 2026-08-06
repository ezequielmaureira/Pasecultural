import { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useActiveEvent } from "../../context/ActiveEventContext.jsx";

// GET /api/sales ya está conectado (ver OrganizerDataContext / Iteración 0
// del Dashboard) — reusa el mismo SalesTable que la card de "Últimas ventas"
// del panel. El selector de evento es nuevo (esta pantalla no tenía
// ninguno): filtra en el cliente sobre `sales`, ya cargado completo por el
// contexto — no agrega ningún fetch. "Todos los eventos" (el default si
// todavía no hay Evento Activo) muestra exactamente lo mismo que antes.
export default function OrganizerSales() {
  const { events, sales, loadingSales } = useOrganizerData();
  const { activeEventId, setActiveEventId } = useActiveEvent();
  const [selectedEventId, setSelectedEventId] = useState("");

  useEffect(() => {
    if (activeEventId && events.some((e) => e.id === activeEventId)) {
      setSelectedEventId((current) => current || activeEventId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEventId, events]);

  function handleChangeEvent(id) {
    setSelectedEventId(id);
    if (id) setActiveEventId(id); // el resto de las pantallas heredan esta elección
  }

  const filteredSales = useMemo(
    () => (selectedEventId ? sales.filter((sale) => sale.eventId === selectedEventId) : sales),
    [sales, selectedEventId]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Ventas</h1>
        <p className="text-sm text-slate-400">
          {loadingSales ? "Cargando…" : `${filteredSales.length} ventas registradas`}
        </p>
      </div>

      <label className="flex max-w-sm flex-col gap-2 text-sm text-slate-300">
        <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
        <select
          value={selectedEventId}
          onChange={(e) => handleChangeEvent(e.target.value)}
          className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
        >
          <option value="">Todos los eventos</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </label>

      <Card>
        <SalesTable sales={filteredSales} loading={loadingSales} />
      </Card>
    </div>
  );
}
