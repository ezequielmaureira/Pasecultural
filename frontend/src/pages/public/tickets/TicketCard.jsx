import { CalendarDays, Clock, MapPin, Ticket, ImageOff, Timer } from "lucide-react";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE, formatEventDate, formatEventTime } from "./ticketStatus.js";
import { useEventCountdown } from "./eventCountdown.js";

export default function TicketCard({ ticket, onOpen }) {
    const time = formatEventTime(ticket.function?.date);
    const showCountdown = ticket.status === "ACTIVE" || ticket.status === "USED";
    const countdown = useEventCountdown(showCountdown ? ticket.function?.date : null);

    return (
        <button
            type="button"
            onClick={() => onOpen(ticket)}
            className="group flex w-full items-stretch gap-4 overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] p-3 text-left transition-colors duration-150 hover:border-violet-500/40"
        >
            <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg bg-white/5 sm:w-24">
                {ticket.event?.coverImage ? (
                    <img
                        src={ticket.event.coverImage}
                        alt={ticket.event.title}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-600">
                        <ImageOff className="h-5 w-5" />
                    </div>
                )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-white">{ticket.event?.title}</p>
                    <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TICKET_STATUS_TONE[ticket.status] ?? "bg-white/10 text-slate-400"}`}
                    >
                        {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                    </span>
                </div>

                <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{formatEventDate(ticket.function?.date)}</span>
                </p>
                {time && (
                    <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {time} hs
                    </p>
                )}
                {ticket.function?.venue && (
                    <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{ticket.function.venue}</span>
                    </p>
                )}
                {countdown && (
                    <p
                        className={`flex items-center gap-1.5 truncate text-xs font-medium ${
                            countdown.phase === "upcoming" ? "text-violet-400" : "text-slate-500"
                        }`}
                    >
                        <Timer className="h-3.5 w-3.5 shrink-0" />
                        {countdown.label}
                    </p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium text-violet-400">
                        <Ticket className="h-3.5 w-3.5 shrink-0" />
                        {ticket.ticketType?.name}
                    </span>
                    <span className="shrink-0 truncate font-mono text-[11px] text-slate-500">
                        {ticket.ticketNumber}
                    </span>
                </div>
            </div>
        </button>
    );
}
