import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Ticket, AlertTriangle, RefreshCw } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { listMyTickets } from "../../lib/ticketApi.js";
import TicketCard from "./tickets/TicketCard.jsx";
import TicketDetailModal from "./tickets/TicketDetailModal.jsx";
import TicketQrModal from "./tickets/TicketQrModal.jsx";

function TicketCardSkeleton() {
    return (
        <div className="flex items-stretch gap-4 rounded-xl border border-white/10 bg-[#0B1120] p-3">
            <div className="aspect-square w-20 shrink-0 animate-pulse rounded-lg bg-white/5 sm:w-24" />
            <div className="flex flex-1 flex-col gap-2 py-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
                <div className="mt-auto h-3 w-1/4 animate-pulse rounded bg-white/5" />
            </div>
        </div>
    );
}

export default function MyTickets() {
    const { getToken } = useAuth();
    const { backendUser } = useBackendUser();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [detailTicket, setDetailTicket] = useState(null);
    const [qrTicket, setQrTicket] = useState(null);

    async function load() {
        setLoading(true);
        setError("");
        try {
            const token = await getToken();
            const data = await listMyTickets(token);
            setTickets(data);
        } catch (err) {
            setError(err.message || "No pudimos cargar tus entradas. Probá de nuevo.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const buyerName =
        [backendUser?.firstName, backendUser?.lastName].filter(Boolean).join(" ").trim() ||
        backendUser?.email ||
        "Vos";

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
            <div>
                <h1 className="text-xl font-bold text-white">Mis entradas</h1>
                <p className="text-sm text-slate-400">
                    Todas las entradas de tus compras confirmadas, en un solo lugar
                </p>
            </div>

            {loading && (
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <TicketCardSkeleton key={i} />
                    ))}
                </div>
            )}

            {!loading && error && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-[#0B1120] px-6 py-16 text-center">
                    <AlertTriangle className="h-8 w-8 text-rose-400" />
                    <p className="text-sm text-slate-400">{error}</p>
                    <Button size="sm" variant="secondary" onClick={load}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reintentar
                    </Button>
                </div>
            )}

            {!loading && !error && tickets.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-[#0B1120] px-6 py-16 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/10">
                        <Ticket className="h-7 w-7 text-violet-400" />
                    </div>
                    <h2 className="text-base font-semibold text-white">Todavía no tenés entradas</h2>
                    <p className="max-w-sm text-sm text-slate-400">
                        Cuando compres una entrada y el organizador confirme el pago, va a aparecer acá con su QR
                        listo para usar.
                    </p>
                </div>
            )}

            {!loading && !error && tickets.length > 0 && (
                <div className="flex flex-col gap-3">
                    {tickets.map((ticket) => (
                        <TicketCard key={ticket.id} ticket={ticket} onOpen={setDetailTicket} />
                    ))}
                </div>
            )}

            {detailTicket && (
                <TicketDetailModal
                    ticket={detailTicket}
                    buyerName={buyerName}
                    onClose={() => setDetailTicket(null)}
                    onShowQr={setQrTicket}
                />
            )}

            {qrTicket && <TicketQrModal ticket={qrTicket} onClose={() => setQrTicket(null)} />}
        </div>
    );
}
