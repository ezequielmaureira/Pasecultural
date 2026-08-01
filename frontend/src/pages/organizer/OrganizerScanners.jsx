import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Plus, Trash2, ScanLine, AlertTriangle, RefreshCw } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { listEventScanners, addEventScanner, removeEventScanner } from "../../lib/eventScannerApi.js";

function scannerName(scanner) {
  return [scanner.user.firstName, scanner.user.lastName].filter(Boolean).join(" ") || scanner.user.email;
}

// El acceso a escanear no es una lista global de "scanners" del organizador
// — es por evento (EventScanner). No hace falta elegir un rol especial de
// cuenta para la persona: cualquier usuario que ya tenga cuenta en
// PaseCultural (comprador, organizador de otro evento, etc.) puede ser
// habilitado acá con sólo su email.
export default function OrganizerScanners() {
  const { getToken } = useAuth();
  const { events, loadingEvents } = useOrganizerData();
  const toast = useToast();

  const [eventId, setEventId] = useState("");
  const [scanners, setScanners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [scannerToRemove, setScannerToRemove] = useState(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!loadingEvents && events.length > 0 && !eventId) {
      setEventId(events[0].id);
    }
  }, [loadingEvents, events, eventId]);

  async function loadScanners(id) {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      setScanners(await listEventScanners(token, id));
    } catch (err) {
      setError(err.message || "No pudimos cargar los scanners de este evento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (eventId) loadScanners(eventId);
  }, [eventId]);

  async function handleAdd(formEvent) {
    formEvent.preventDefault();
    if (!email.trim()) return;

    setAdding(true);
    try {
      const token = await getToken();
      await addEventScanner(token, eventId, email.trim());
      setEmail("");
      toast.success("Scanner habilitado para este evento.");
      loadScanners(eventId);
    } catch (err) {
      toast.error(err.message || "No pudimos habilitar ese email como scanner.");
    } finally {
      setAdding(false);
    }
  }

  async function confirmRemove() {
    if (!scannerToRemove) return;
    setRemoving(true);
    try {
      const token = await getToken();
      await removeEventScanner(token, eventId, scannerToRemove.user.id);
      toast.success("Scanner revocado.");
      setScannerToRemove(null);
      loadScanners(eventId);
    } catch (err) {
      toast.error(err.message || "No pudimos revocar ese scanner.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Scanners</h1>
        <p className="text-sm text-slate-400">
          Habilitá quién puede validar entradas de cada uno de tus eventos
        </p>
      </div>

      {!loadingEvents && events.length === 0 && (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ScanLine className="h-6 w-6 text-slate-600" />
            <p className="text-sm text-slate-400">
              Creá un evento primero para poder habilitar scanners.
            </p>
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <>
          <Field label="Evento" className="max-w-sm">
            <select className={inputClass} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </Field>

          <Card>
            <form onSubmit={handleAdd} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Field label="Email de la persona a habilitar" className="flex-1">
                <input
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="scanner@example.com"
                  required
                />
              </Field>
              <Button type="submit" loading={adding} loadingText="Habilitando...">
                <Plus className="h-4 w-4" />
                Habilitar
              </Button>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Tiene que ser el email de alguien que ya tenga cuenta en PaseCultural — no envía invitación por
              correo, sólo habilita esa cuenta para escanear este evento.
            </p>
          </Card>

          <div className="rounded-xl border border-white/10 bg-[#0B1120]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-6 py-3 font-medium">Nombre</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading &&
                    Array.from({ length: 2 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4" colSpan={3}>
                          <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
                        </td>
                      </tr>
                    ))}

                  {!loading && error && (
                    <tr>
                      <td className="px-6 py-12" colSpan={3}>
                        <div className="flex flex-col items-center gap-3 text-center">
                          <AlertTriangle className="h-6 w-6 text-rose-400" />
                          <p className="text-sm text-slate-400">{error}</p>
                          <Button size="sm" variant="secondary" onClick={() => loadScanners(eventId)}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reintentar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    !error &&
                    scanners.map((scanner) => (
                      <tr key={scanner.id}>
                        <td className="px-6 py-4 font-medium text-white">{scannerName(scanner)}</td>
                        <td className="px-6 py-4 text-slate-400">{scanner.user.email}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            title="Revocar acceso"
                            onClick={() => setScannerToRemove(scanner)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}

                  {!loading && !error && scanners.length === 0 && (
                    <tr>
                      <td className="px-6 py-12" colSpan={3}>
                        <div className="flex flex-col items-center gap-3 text-center">
                          <ScanLine className="h-8 w-8 text-slate-600" />
                          <p className="text-sm text-slate-400">
                            Todavía no habilitaste a nadie para escanear este evento.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {scannerToRemove && (
        <ConfirmDialog
          title="Revocar scanner"
          description={`¿Seguro que querés revocarle el acceso a "${scannerName(scannerToRemove)}"? Va a dejar de poder escanear este evento de inmediato.`}
          confirmLabel="Revocar"
          danger
          loading={removing}
          onConfirm={confirmRemove}
          onClose={() => setScannerToRemove(null)}
        />
      )}
    </div>
  );
}
