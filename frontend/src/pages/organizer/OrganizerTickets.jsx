import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";

export default function OrganizerTickets() {
  const { events } = useOrganizerData();

  const rows = events.flatMap((event) =>
    event.ticketTypes.map((tt) => ({
      ...tt,
      eventId: event.id,
      eventName: event.name,
    }))
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Entradas</h1>
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
            <tbody className="divide-y divide-white/5">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-6 py-4 text-slate-300">
                    {row.eventName}
                  </td>
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-2 font-medium text-white">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.name}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-300">${row.price}</td>
                  <td className="px-6 py-4 text-slate-300">{row.stock}</td>
                  <td className="px-6 py-4 text-slate-300">
                    {row.sold ?? 0}
                  </td>
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
                  <td className="px-6 py-6 text-center text-slate-500" colSpan={7}>
                    Todavía no creaste tipos de entrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
