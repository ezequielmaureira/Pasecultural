import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Ban, RefreshCw } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import Spinner from "../../../components/ui/Spinner.jsx";
import Button from "../../../components/ui/Button.jsx";
import { getTicketQr } from "../../../lib/ticketApi.js";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "./ticketStatus.js";

// El QR se pide de nuevo cada vez que se abre este modal (nunca se
// cachea/persiste del lado del cliente) y se renderiza 100% en el momento
// con qrcode.react (SVG) — nunca se genera ni se guarda ninguna imagen.
export default function TicketQrModal({ ticket, onClose }) {
    const { getToken } = useAuth();
    const [qr, setQr] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load() {
        setLoading(true);
        setError("");
        try {
            const token = await getToken();
            const payload = await getTicketQr(token, ticket.id);
            setQr(payload);
        } catch (err) {
            setError(err.message || "No pudimos cargar el QR. Probá de nuevo.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticket.id]);

    const isUsed = ticket.status === "USED";
    const isCancelled = ticket.status === "CANCELLED" || ticket.status === "REFUNDED";

    return (
        <Modal title="Código QR" onClose={onClose} maxWidth="max-w-sm">
            <div className="flex flex-col items-center gap-4 text-center">
                {loading && (
                    <div className="flex h-64 w-64 items-center justify-center">
                        <Spinner size="lg" />
                    </div>
                )}

                {!loading && error && (
                    <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 text-center">
                        <AlertTriangle className="h-8 w-8 text-rose-400" />
                        <p className="text-sm text-slate-400">{error}</p>
                        <Button size="sm" variant="secondary" onClick={load}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reintentar
                        </Button>
                    </div>
                )}

                {!loading && !error && qr && (
                    <>
                        <div className="relative flex h-64 w-64 items-center justify-center rounded-xl bg-white p-4">
                            <QRCodeSVG
                                value={qr.qrToken}
                                size={224}
                                level="M"
                                title={`Código QR de tu entrada ${qr.ticketNumber}`}
                            />
                            {(isUsed || isCancelled) && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/85">
                                    <Ban className="h-16 w-16 text-rose-500" />
                                </div>
                            )}
                        </div>

                        {isUsed && (
                            <p className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-400">
                                Esta entrada ya fue utilizada
                            </p>
                        )}
                        {isCancelled && (
                            <p className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-400">
                                {ticket.status === "REFUNDED" ? "Entrada reembolsada" : "Entrada cancelada"}
                            </p>
                        )}

                        <div className="flex w-full flex-col gap-1">
                            <p className="truncate text-sm font-semibold text-white">{ticket.event?.title}</p>
                            <p className="font-mono text-xs text-slate-500">{qr.ticketNumber}</p>
                            <div className="mt-1 flex items-center justify-center gap-2">
                                <span className="text-xs text-slate-400">{ticket.ticketType?.name}</span>
                                <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TICKET_STATUS_TONE[ticket.status] ?? "bg-white/10 text-slate-400"}`}
                                >
                                    {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
