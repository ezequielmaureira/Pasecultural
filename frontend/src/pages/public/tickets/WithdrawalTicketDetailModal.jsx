import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Ban, Clock, RefreshCw } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import Spinner from "../../../components/ui/Spinner.jsx";
import Button from "../../../components/ui/Button.jsx";
import { getSaleStatus } from "../../../lib/saleApi.js";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "./ticketStatus.js";

// Botón de arrepentimiento — "Ver entrada(s)" en "Elegí la compra".
// Autorización EXACTAMENTE igual a "Descartar solicitud"/"Volver a
// contactar": conocer el saleToken (publicRecoveryToken) alcanza, nunca
// sesión. Reutiliza getSaleStatus (ya público, ya autorizado por token, ya
// arma qrToken con decryptSecret) — nunca un endpoint nuevo ni un
// generador de QR paralelo; el QR en sí se renderiza con QRCodeSVG, la
// misma librería que ya usa TicketQrModal.jsx (flujo logueado). No se
// reutiliza ESE componente literal porque pide el QR vía un endpoint
// autenticado con Clerk (getTicketQr) — auth model distinto al de este
// flujo sin sesión.
function hoursRemaining(expiresAt) {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
}

export default function WithdrawalTicketDetailModal({ saleToken, eventTitle, onClose }) {
    const [tickets, setTickets] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load() {
        setLoading(true);
        setError("");
        try {
            const result = await getSaleStatus(saleToken);
            setTickets(Array.isArray(result?.tickets) ? result.tickets : []);
        } catch (err) {
            setError(err.message || "No pudimos cargar el detalle de tus entradas.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saleToken]);

    return (
        <Modal title={eventTitle ? `Detalle de entradas — ${eventTitle}` : "Detalle de entradas"} onClose={onClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-4">
                {loading && (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size="lg" />
                    </div>
                )}

                {!loading && error && (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <AlertTriangle className="h-8 w-8 text-rose-400" />
                        <p className="text-sm text-slate-400">{error}</p>
                        <Button size="sm" variant="secondary" onClick={load}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reintentar
                        </Button>
                    </div>
                )}

                {!loading && !error && tickets?.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-400">No encontramos entradas para esta compra.</p>
                )}

                {!loading &&
                    !error &&
                    tickets?.map((ticket, index) => {
                        // Devuelta por el organizador (ventana de 24h, ver
                        // getSaleStatusService) — nunca se confunde con un
                        // CANCELLED por otro motivo: ese caso llega acá con
                        // returnedAt null y se muestra igual que siempre.
                        const isReturned = Boolean(ticket.returnedAt);
                        const isUsed = ticket.status === "USED" && !isReturned;
                        const isOtherCancelled = (ticket.status === "CANCELLED" || ticket.status === "REFUNDED") && !isReturned;
                        const isActive = ticket.status === "ACTIVE" && !isReturned;
                        const remainingHours = isReturned ? hoursRemaining(ticket.returnWindowExpiresAt) : null;

                        return (
                            <div key={ticket.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-slate-500">Entrada {index + 1}</p>
                                        <p className="truncate text-sm font-semibold text-white">{ticket.ticketTypeName}</p>
                                        <p className="font-mono text-xs text-slate-500">{ticket.ticketNumber}</p>
                                    </div>
                                    <span
                                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                                            isReturned ? "bg-amber-500/10 text-amber-400" : TICKET_STATUS_TONE[ticket.status] ?? "bg-white/10 text-slate-400"
                                        }`}
                                    >
                                        {isReturned ? "Devuelta" : TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                                    </span>
                                </div>

                                {isActive && (
                                    <>
                                        <div className="flex justify-center rounded-xl bg-white p-4">
                                            <QRCodeSVG value={ticket.qrToken} size={160} level="M" title={`Código QR de tu entrada ${ticket.ticketNumber}`} />
                                        </div>
                                        <p className="text-center text-xs text-slate-400">Esta entrada está activa y puede utilizarse.</p>
                                    </>
                                )}

                                {isUsed && <p className="rounded-lg bg-white/5 px-3 py-2 text-center text-xs text-slate-400">Esta entrada ya fue utilizada.</p>}

                                {isReturned && (
                                    <>
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl bg-white/5">
                                            <Ban className="h-10 w-10 text-rose-400" />
                                            <span className="text-xs font-semibold text-rose-400">QR invalidado</span>
                                        </div>
                                        <p className="text-center text-xs text-slate-400">
                                            Esta entrada fue marcada como devuelta por el organizador y ya no puede utilizarse.
                                        </p>
                                        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-amber-400">
                                            <Clock className="h-3.5 w-3.5 shrink-0" />
                                            {remainingHours
                                                ? `Desaparecerá de este panel en aproximadamente ${remainingHours}h.`
                                                : "Desaparecerá de este panel en 24 horas."}
                                        </p>
                                    </>
                                )}

                                {isOtherCancelled && (
                                    <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-center text-xs font-semibold text-rose-400">
                                        {ticket.status === "REFUNDED" ? "Entrada reembolsada" : "Entrada cancelada"}
                                    </p>
                                )}
                            </div>
                        );
                    })}
            </div>
        </Modal>
    );
}
