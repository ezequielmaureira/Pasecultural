import { ChevronLeft, ImageOff } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";
import { currency } from "../../../organizer/eventWizard/model.js";
import { formatEventDateTime, formatEventLocation } from "../../../../lib/eventFormat.js";

export default function SummaryStep({ event, selectedFunction, lineItems, ticketsSubtotal, serviceFeeTotal, total, onBack, onContinue }) {
  return (
    <Card>
      <div className="flex flex-col gap-1 pb-4 text-center">
        <h2 className="text-lg font-bold text-white">Resumen de compra</h2>
        <p className="text-sm text-slate-400">Revisá los detalles de tu compra</p>
      </div>

      <div className="mb-4 flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {event.coverImage ? (
            <img src={event.coverImage} alt={event.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-600">
              <ImageOff className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{event.title}</p>
          <p className="truncate text-xs text-slate-400">{formatEventDateTime(selectedFunction.date)}</p>
          <p className="truncate text-xs text-slate-400">{formatEventLocation(event)}</p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-white/5">
        {lineItems.map((item) => (
          <div key={item.ticketTypeId} className="flex items-center justify-between py-2.5 text-sm">
            <span className="text-slate-300">
              {item.name} <span className="text-slate-500">{item.quantity} x {currency(item.unitPrice)}</span>
            </span>
            <span className="font-medium text-white">{currency(item.subtotal)}</span>
          </div>
        ))}
      </div>

      {/* MP-6 — la comisión de servicio se SUMA por encima del precio de
          las entradas, nunca se descuenta del organizador ni se esconde
          dentro de un único número — se muestra siempre desglosada acá,
          antes de continuar al pago. */}
      <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Entradas</span>
          <span className="text-slate-300">{currency(ticketsSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Comisión de servicio</span>
          <span className="text-slate-300">{currency(serviceFeeTotal)}</span>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-slate-300">Total</span>
          <span className="text-xl font-bold text-violet-400">{currency(total)}</span>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <Button variant="secondary" onClick={onBack} className="flex-1 justify-center">
          <ChevronLeft className="h-4 w-4" />
          Volver
        </Button>
        <Button onClick={onContinue} className="flex-1 justify-center">
          Continuar
        </Button>
      </div>
    </Card>
  );
}
