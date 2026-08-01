import { Minus, Plus, ImageOff, CalendarDays, MapPin } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";
import { currency } from "../../../organizer/eventWizard/model.js";
import { formatEventDateTime, formatEventLocation } from "../../../../lib/eventFormat.js";

// No muestra "stock restante": el endpoint público no trae cuántas
// entradas de cada tipo ya se vendieron (ver análisis previo a esta fase),
// así que mostrar un número ahí sería inventarlo. El límite real lo aplica
// el backend en el momento de comprar (INSUFFICIENT_STOCK) — ver ErrorStep.
export default function SelectTicketsStep({ event, selectedFunction, ticketOptions, quantities, onQuantityChange, total, onContinue }) {
  const hasSelection = Object.values(quantities).some((qty) => qty > 0);

  return (
    <Card>
      <div className="mb-5 flex gap-3 border-b border-white/10 pb-5">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {event.coverImage ? (
            <img src={event.coverImage} alt={event.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-600">
              <ImageOff className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{event.title}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {formatEventDateTime(selectedFunction.date)}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {formatEventLocation(event)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 pb-4 text-center">
        <h2 className="text-lg font-bold text-white">Elegí tus entradas</h2>
        <p className="text-sm text-slate-400">Seleccioná la cantidad de cada tipo</p>
      </div>

      <div className="flex flex-col gap-3">
        {ticketOptions.map((option) => {
          const qty = quantities[option.ticketTypeId] ?? 0;
          return (
            <div key={option.ticketTypeId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{option.name}</p>
                {option.description && <p className="truncate text-xs text-slate-500">{option.description}</p>}
                <p className="text-sm text-violet-400">{currency(option.price)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  disabled={qty === 0}
                  onClick={() => onQuantityChange(option.ticketTypeId, -1)}
                  aria-label={`Restar ${option.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors duration-150 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-4 text-center text-sm font-semibold text-white">{qty}</span>
                <button
                  type="button"
                  onClick={() => onQuantityChange(option.ticketTypeId, 1)}
                  aria-label={`Sumar ${option.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors duration-150 hover:bg-violet-500"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        {ticketOptions.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">Este evento no tiene entradas disponibles todavía.</p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-sm text-slate-400">Total</span>
        <span className="text-lg font-bold text-white">{currency(total)}</span>
      </div>

      <Button className="mt-4 w-full justify-center" disabled={!hasSelection} onClick={onContinue}>
        Continuar
      </Button>
    </Card>
  );
}
