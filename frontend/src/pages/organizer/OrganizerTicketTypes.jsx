import { Link } from "react-router-dom";
import { Pencil, Ticket, Plus } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";

function TableSkeleton() {
  return (
    <tbody className="divide-y divide-white/5">
      {Array.from({ length: 3 }).map((_, i) => (
        <tr key={i}>
          <td className="px-6 py-4" colSpan={7}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// Catálogo de TIPOS de entrada (General, VIP, precio/stock) de todos los
// eventos — distinto de "Entradas" (OrganizerTickets.jsx), que administra
// las entradas VENDIDAS individuales. Este archivo es el contenido que
// antes vivía en OrganizerTickets.jsx, trasladado tal cual (mismo
// componente, misma tabla, mismos datos) — sólo cambió el título y esta
// pantalla pasó a su propia ruta.
export default function OrganizerTicketTypes() {
  const { events, loadingEvents } = useOrganizerData();

  const rows = events.flatMap((event) =>
    (event.ticketTypes ?? []).map((tt) => ({
      ...tt,
      eventId: event.id,
      eventName: event.title,
    }))
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Tipos de entrada</h1>
        <p className="text-sm text-slate-400">
          Tipos de entrada de todos tus eventos. Se crean y editan desde cada
          evento.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Tipo</th>
                <th className="px-6 py-3 font-medium">Precio</th>
                <th className="px-6 py-3 font-medium">Stock</th>
                <th className="px-6 py-3 font-medium">Vendidas</th>
                <th className="px-6 py-3 font-medium">Visible</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            {loadingEvents ? (
              <TableSkeleton />
            ) : (
              <tbody className="divide-y divide-white/5">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-6 py-4 text-slate-300">
                      {row.eventName}
                    </td>
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-2 font-medium text-white">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
                        {row.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-300">${row.price}</td>
                    <td className="px-6 py-4 text-slate-300">{row.quantity}</td>
                    <td className="px-6 py-4 text-slate-300">0</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.visible
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-white/10 text-slate-400"
                        }`}
                      >
                        {row.visible ? "Sí" : "No"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/organizador/eventos/${row.eventId}/editar`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                        title="Editar en el evento"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="px-6 py-12" colSpan={7}>
                      <div className="flex flex-col items-center gap-3 text-center">
                        <Ticket className="h-8 w-8 text-slate-600" />
                        <p className="text-sm text-slate-400">
                          No tenés tipos de entradas creados todavía.
                        </p>
                        <Link to="/organizador/eventos/nuevo">
                          <Button size="sm">
                            <Plus className="h-4 w-4" />
                            Crear mi primer evento
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
