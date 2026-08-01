import { Link } from "react-router-dom";
import { CalendarDays, Clock, MapPin, Ticket, ImageOff, QrCode, User, Timer, ExternalLink } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import Button from "../../../components/ui/Button.jsx";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE, formatEventDate, formatEventTime } from "./ticketStatus.js";
import { useEventCountdown } from "./eventCountdown.js";

function Row({ icon: Icon, label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="truncate text-sm text-slate-200">{value}</p>
            </div>
        </div>
    );
}

// Comprador y propietario: hoy siempre son el mismo usuario que está viendo
// la entrada (TicketService sólo deja ver el ticket a su owner, y buyerId
// == ownerId hasta que exista transferencia de entradas) — se muestran con
// los datos del usuario logueado en vez de pedirle al backend algo que
// TicketService no expone (no se modifica el backend en esta fase).
export default function TicketDetailModal({ ticket, buyerName, onClose, onShowQr }) {
    const time = formatEventTime(ticket.function?.date);
    const showCountdown = ticket.status === "ACTIVE" || ticket.status === "USED";
    const countdown = useEventCountdown(showCountdown ? ticket.function?.date : null);

    return (
        <Modal title="Detalle de la entrada" onClose={onClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-5">
                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-white/5">
                    {ticket.event?.coverImage ? (
                        <img
                            src={ticket.event.coverImage}
                            alt={ticket.event.title}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-600">
                            <ImageOff className="h-6 w-6" />
                        </div>
                    )}
                </div>

                <div className="flex items-start justify-between gap-3">
                    <h4 className="text-lg font-bold text-white">{ticket.event?.title}</h4>
                    <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${TICKET_STATUS_TONE[ticket.status] ?? "bg-white/10 text-slate-400"}`}
                    >
                        {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                    </span>
                </div>

                {countdown && (
                    <p
                        className={`-mt-3 flex items-center gap-1.5 text-sm font-medium ${
                            countdown.phase === "upcoming" ? "text-violet-400" : "text-slate-500"
                        }`}
                    >
                        <Timer className="h-4 w-4 shrink-0" />
                        {countdown.label}
                    </p>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Row icon={CalendarDays} label="Fecha" value={formatEventDate(ticket.function?.date)} />
                    <Row icon={Clock} label="Hora" value={time ? `${time} hs` : null} />
                    <Row icon={MapPin} label="Lugar" value={ticket.function?.venue} />
                    <Row icon={Ticket} label="Tipo de entrada" value={ticket.ticketType?.name} />
                    <Row icon={Ticket} label="Número de ticket" value={ticket.ticketNumber} />
                    <Row icon={User} label="Comprador" value={buyerName} />
                    <Row icon={User} label="Propietario" value={buyerName} />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button className="flex-1 justify-center" onClick={() => onShowQr(ticket)}>
                        <QrCode className="h-4 w-4" />
                        Mostrar QR
                    </Button>
                    {ticket.event?.slug && (
                        <Link to={`/evento/${ticket.event.slug}`} className="flex-1">
                            <Button variant="secondary" className="w-full justify-center">
                                <ExternalLink className="h-4 w-4" />
                                Ver evento
                            </Button>
                        </Link>
                    )}
                </div>
            </div>
        </Modal>
    );
}
