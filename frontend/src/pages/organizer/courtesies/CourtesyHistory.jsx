import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Gift, Mail, Download, Link2, XCircle, Share2 } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import SkeletonBlock from "../../../components/ui/SkeletonBlock.jsx";
import { useOrganizerData } from "../../../context/OrganizerDataContext.jsx";
import { useToast } from "../../../context/ToastContext.jsx";
import { listCourtesies, getCourtesyStats, resendCourtesyEmail, downloadCourtesyPdf, cancelCourtesy } from "../../../lib/courtesyApi.js";
import { formatDateTime } from "../../../lib/format.js";
import { formatEventDateTime } from "../../../lib/eventFormat.js";

const STATUS_LABEL = { PENDING: "Pendiente", DELIVERED: "Entregada", USED: "Utilizada", CANCELLED: "Cancelada" };
const STATUS_TONE = { PENDING: "warning", DELIVERED: "info", USED: "success", CANCELLED: "danger" };
const REASON_LABEL = {
    SPONSOR: "Sponsor",
    PRENSA: "Prensa",
    INVITADO: "Invitado",
    STAFF: "Staff",
    ARTISTA: "Artista",
    FAMILIAR: "Familiar",
    PROTOCOLO: "Protocolo",
    OTRO: "Otro",
};

function buildShareUrl(publicRecoveryToken) {
    return `${window.location.origin}/comprar?saleToken=${publicRecoveryToken}`;
}

export default function CourtesyHistory() {
    const { getToken } = useAuth();
    const toast = useToast();
    const { events } = useOrganizerData();

    const [eventId, setEventId] = useState("");
    const [status, setStatus] = useState("");
    const [reason, setReason] = useState("");

    const [courtesies, setCourtesies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [stats, setStats] = useState(null);

    // Acciones por fila en curso — evita doble click mientras hay una
    // request de esa fila en vuelo, sin bloquear el resto de la tabla.
    const [pendingRowAction, setPendingRowAction] = useState(null); // `${saleId}:${action}` | null

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const token = await getToken();
            const list = await listCourtesies(token, { eventId: eventId || undefined, status: status || undefined, reason: reason || undefined });
            setCourtesies(list);
            if (eventId) setStats(await getCourtesyStats(token, eventId));
            else setStats(null);
        } catch (err) {
            setError(err.message || "No pudimos cargar el historial de cortesías.");
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, status, reason]);

    useEffect(() => {
        load();
    }, [load]);

    async function runRowAction(saleId, actionKey, fn) {
        setPendingRowAction(`${saleId}:${actionKey}`);
        try {
            await fn();
        } catch (err) {
            toast.error(err.message || "No pudimos completar la acción.");
        } finally {
            setPendingRowAction(null);
        }
    }

    async function handleShareAgain(row) {
        const url = buildShareUrl(row.publicRecoveryToken);
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: `Cortesía — ${row.event?.title}`, url });
                return;
            } catch {
                // Cancelado por el usuario, o el navegador lo rechazó — cae a copiar.
            }
        }
        await navigator.clipboard.writeText(url);
        toast.success("Enlace copiado.");
    }

    async function handleCopyLink(row) {
        await navigator.clipboard.writeText(buildShareUrl(row.publicRecoveryToken));
        toast.success("Enlace copiado.");
    }

    async function handleResendEmail(row) {
        const token = await getToken();
        await resendCourtesyEmail(token, row.saleId);
        toast.success("Correo reenviado.");
    }

    async function handleDownloadPdf(row) {
        const token = await getToken();
        const { blob, filename } = await downloadCourtesyPdf(token, row.saleId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function handleCancel(row) {
        if (!window.confirm("¿Cancelar esta cortesía? Las entradas ya emitidas dejan de ser válidas.")) return;
        const token = await getToken();
        await cancelCourtesy(token, row.saleId);
        toast.success("Cortesía cancelada.");
        load();
    }

    const isRowActionPending = (saleId, actionKey) => pendingRowAction === `${saleId}:${actionKey}`;

    const statsSummary = useMemo(() => {
        if (!stats) return null;
        return [
            { label: "Emitidas", value: stats.issued },
            { label: "Utilizadas", value: stats.used },
            { label: "Pendientes", value: stats.pending },
            { label: "Canceladas", value: stats.cancelled },
        ];
    }, [stats]);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-white">Historial de cortesías</h1>
                <p className="text-sm text-slate-400">{loading ? "Cargando…" : `${courtesies.length} cortesías`}</p>
            </div>

            <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1.5 text-sm text-slate-300">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="h-10 min-w-[200px] rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none">
                        <option value="">Todos los eventos</option>
                        {events.map((event) => (
                            <option key={event.id} value={event.id}>
                                {event.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-slate-300">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Estado</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none">
                        <option value="">Todos</option>
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-slate-300">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Motivo</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none">
                        <option value="">Todos</option>
                        {Object.entries(REASON_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {statsSummary && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {statsSummary.map((s) => (
                        <Card key={s.label} className="p-4 text-center">
                            <p className="text-xl font-bold text-white">{s.value}</p>
                            <p className="text-xs text-slate-500">{s.label}</p>
                        </Card>
                    ))}
                </div>
            )}

            <Card>
                {loading && (
                    <div className="flex flex-col gap-3">
                        {["w-full", "w-11/12", "w-full"].map((w, i) => (
                            <SkeletonBlock key={i} className={`h-10 ${w}`} />
                        ))}
                    </div>
                )}

                {!loading && error && <p className="text-sm text-rose-400">{error}</p>}

                {!loading && !error && courtesies.length === 0 && (
                    <EmptyState icon={Gift}>Todavía no emitiste ninguna cortesía.</EmptyState>
                )}

                {!loading && !error && courtesies.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[960px] text-left text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                                    <th className="py-2 pr-3 font-medium">Fecha</th>
                                    <th className="py-2 pr-3 font-medium">Evento</th>
                                    <th className="py-2 pr-3 font-medium">Función</th>
                                    <th className="py-2 pr-3 font-medium">Tipo</th>
                                    <th className="py-2 pr-3 font-medium">Destinatario</th>
                                    <th className="py-2 pr-3 font-medium">Cant.</th>
                                    <th className="py-2 pr-3 font-medium">Motivo</th>
                                    <th className="py-2 pr-3 font-medium">Emitida por</th>
                                    <th className="py-2 pr-3 font-medium">Estado</th>
                                    <th className="py-2 font-medium">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {courtesies.map((row) => (
                                    <tr key={row.saleId} className="transition-colors duration-150 hover:bg-white/[0.03]">
                                        <td className="py-2.5 pr-3 text-slate-500">{formatDateTime(row.createdAt)}</td>
                                        <td className="max-w-[160px] truncate py-2.5 pr-3 text-slate-300">{row.event?.title}</td>
                                        <td className="py-2.5 pr-3 text-slate-300">{row.function ? formatEventDateTime(row.function.date) : "—"}</td>
                                        <td className="py-2.5 pr-3 text-slate-300">{row.ticketType?.name ?? "—"}</td>
                                        <td className="max-w-[160px] truncate py-2.5 pr-3 text-slate-300">{row.recipientEmail ?? "—"}</td>
                                        <td className="py-2.5 pr-3 text-slate-300">{row.quantity}</td>
                                        <td className="py-2.5 pr-3 text-slate-300">{row.reason ? REASON_LABEL[row.reason] ?? row.reason : "—"}</td>
                                        <td className="max-w-[140px] truncate py-2.5 pr-3 text-slate-300">{row.issuedBy ?? "—"}</td>
                                        <td className="py-2.5 pr-3">
                                            <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                                        </td>
                                        <td className="py-2.5">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    title="Compartir de nuevo"
                                                    disabled={isRowActionPending(row.saleId, "share")}
                                                    onClick={() => runRowAction(row.saleId, "share", () => handleShareAgain(row))}
                                                    className="text-slate-400 transition-colors duration-150 hover:text-white disabled:opacity-40"
                                                >
                                                    <Share2 className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Copiar enlace"
                                                    disabled={isRowActionPending(row.saleId, "copy")}
                                                    onClick={() => runRowAction(row.saleId, "copy", () => handleCopyLink(row))}
                                                    className="text-slate-400 transition-colors duration-150 hover:text-white disabled:opacity-40"
                                                >
                                                    <Link2 className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Reenviar por correo"
                                                    disabled={isRowActionPending(row.saleId, "email") || row.status === "CANCELLED"}
                                                    onClick={() => runRowAction(row.saleId, "email", () => handleResendEmail(row))}
                                                    className="text-slate-400 transition-colors duration-150 hover:text-white disabled:opacity-40"
                                                >
                                                    <Mail className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Descargar PDF"
                                                    disabled={isRowActionPending(row.saleId, "pdf")}
                                                    onClick={() => runRowAction(row.saleId, "pdf", () => handleDownloadPdf(row))}
                                                    className="text-slate-400 transition-colors duration-150 hover:text-white disabled:opacity-40"
                                                >
                                                    <Download className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Cancelar"
                                                    disabled={isRowActionPending(row.saleId, "cancel") || row.status === "CANCELLED"}
                                                    onClick={() => runRowAction(row.saleId, "cancel", () => handleCancel(row))}
                                                    className="text-rose-400/80 transition-colors duration-150 hover:text-rose-400 disabled:opacity-40"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
