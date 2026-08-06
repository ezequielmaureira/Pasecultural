import Card from "../../components/ui/Card.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";

// GET /api/sales ya está conectado (ver OrganizerDataContext / Iteración 0
// del Dashboard) — reusa el mismo SalesTable que la card de "Últimas ventas"
// del panel. Sigue sin filtros/paginación propios (fuera de alcance de esta
// iteración): eso queda para cuando esta pantalla deje de ser "la lista
// completa tal cual" y necesite herramientas propias de búsqueda.
export default function OrganizerSales() {
  const { sales, loadingSales } = useOrganizerData();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Ventas</h1>
        <p className="text-sm text-slate-400">
          {loadingSales ? "Cargando…" : `${sales.length} ventas registradas`}
        </p>
      </div>

      <Card>
        <SalesTable sales={sales} loading={loadingSales} />
      </Card>
    </div>
  );
}
