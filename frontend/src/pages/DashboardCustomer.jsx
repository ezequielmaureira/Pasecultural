import { Ticket, CalendarCheck, Clock3 } from "lucide-react";
import Card from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const STATS = [
  { label: "Entradas activas", value: "2", icon: Ticket },
  { label: "Eventos asistidos", value: "7", icon: CalendarCheck },
  { label: "Próximo evento en", value: "3 días", icon: Clock3 },
];

const MY_TICKETS = [
  {
    name: "Rock Nacional",
    date: "24/07/2025 - 21:00",
    venue: "Teatro del Libertador",
    code: "PC-88213",
  },
  {
    name: "Festival de Jazz",
    date: "26/07/2025 - 19:00",
    venue: "Centro Cultural",
    code: "PC-90042",
  },
];

const RECOMMENDED_EVENTS = [
  { name: "Stand Up Comedy", date: "25/07/2025 - 20:30", price: "$4.500" },
  { name: "Expo Arte 2025", date: "02/08/2025 - 18:00", price: "$2.800" },
  { name: "Noche de Tango", date: "09/08/2025 - 21:30", price: "$5.200" },
];

export default function DashboardCustomer() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Mi cuenta</h1>
        <p className="text-sm text-slate-400">Tus entradas y eventos</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Icon className="h-4 w-4" />
              {label}
            </div>
            <p className="mt-3 text-2xl font-bold text-white">{value}</p>
          </Card>
        ))}
      </div>

      <Card title="Mis próximas entradas">
        <div className="flex flex-col divide-y divide-white/10">
          {MY_TICKETS.map((ticket) => (
            <div
              key={ticket.code}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
            >
              <div className="h-12 w-12 shrink-0 rounded-lg bg-white/10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {ticket.name}
                </p>
                <p className="text-xs text-slate-500">
                  {ticket.date} · {ticket.venue}
                </p>
              </div>
              <Button variant="secondary" size="sm">
                Ver QR
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Eventos recomendados">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {RECOMMENDED_EVENTS.map((event) => (
            <div
              key={event.name}
              className="flex flex-col gap-3 rounded-lg border border-white/10 p-4"
            >
              <div className="h-24 w-full rounded-lg bg-white/10" />
              <div>
                <p className="text-sm font-medium text-white">{event.name}</p>
                <p className="text-xs text-slate-500">{event.date}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                  {event.price}
                </span>
                <Button size="sm">Comprar</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
