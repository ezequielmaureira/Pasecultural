import { useState } from "react";
import { Plus, Power, Trash2, CalendarPlus, ScanLine } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";

const inputClass =
  "h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20";

function formatLastAccess(value) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrganizerScanners() {
  const { events, scanners, addScanner, updateScanner, removeScanner } =
    useOrganizerData();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [newScanner, setNewScanner] = useState({ name: "", email: "" });
  const [assigningId, setAssigningId] = useState(null);
  const [scannerToDelete, setScannerToDelete] = useState(null);

  function handleCreate(event) {
    event.preventDefault();
    if (!newScanner.name || !newScanner.email) return;
    addScanner(newScanner);
    setNewScanner({ name: "", email: "" });
    setShowForm(false);
    toast.success("Scanner agregado.");
  }

  function confirmDeleteScanner() {
    if (!scannerToDelete) return;
    removeScanner(scannerToDelete.id);
    setScannerToDelete(null);
    toast.success("Scanner eliminado.");
  }

  function toggleStatus(scanner) {
    updateScanner(scanner.id, {
      status: scanner.status === "Activo" ? "Inactivo" : "Activo",
    });
  }

  function toggleEvent(scanner, eventId) {
    const assigned = scanner.assignedEvents.includes(eventId);
    updateScanner(scanner.id, {
      assignedEvents: assigned
        ? scanner.assignedEvents.filter((id) => id !== eventId)
        : [...scanner.assignedEvents, eventId],
    });
  }

  const assigningScanner = scanners.find((s) => s.id === assigningId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Scanners</h1>
          <p className="text-sm text-slate-400">
            Administrá el equipo que valida entradas en tus eventos
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4" />
          Nuevo scanner
        </Button>
      </div>

      {showForm && (
        <Card>
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-400">Nombre</span>
              <input
                className={inputClass}
                value={newScanner.name}
                onChange={(e) =>
                  setNewScanner((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre y apellido"
                required
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-400">Email</span>
              <input
                type="email"
                className={inputClass}
                value={newScanner.email}
                onChange={(e) =>
                  setNewScanner((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="scanner@example.com"
                required
              />
            </label>
            <Button type="submit">Agregar</Button>
          </form>
        </Card>
      )}

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Nombre</th>
                <th className="px-6 py-3 font-medium">Eventos asignados</th>
                <th className="px-6 py-3 font-medium">Último acceso</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {scanners.map((scanner) => (
                <tr key={scanner.id}>
                  <td className="px-6 py-4">
                    <p className="font-medium text-white">{scanner.name}</p>
                    <p className="text-xs text-slate-500">{scanner.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {scanner.assignedEvents.length === 0 && (
                        <span className="text-xs text-slate-500">
                          Sin asignar
                        </span>
                      )}
                      {scanner.assignedEvents.map((eventId) => {
                        const event = events.find((e) => e.id === eventId);
                        if (!event) return null;
                        return (
                          <span
                            key={eventId}
                            className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-300"
                          >
                            {event.name}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {formatLastAccess(scanner.lastAccess)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        scanner.status === "Activo"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-white/10 text-slate-400"
                      }`}
                    >
                      {scanner.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Asignar eventos"
                        onClick={() => setAssigningId(scanner.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <CalendarPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={
                          scanner.status === "Activo"
                            ? "Desactivar"
                            : "Activar"
                        }
                        onClick={() => toggleStatus(scanner)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Eliminar"
                        onClick={() => setScannerToDelete(scanner)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {scanners.length === 0 && (
                <tr>
                  <td className="px-6 py-12" colSpan={5}>
                    <div className="flex flex-col items-center gap-3 text-center">
                      <ScanLine className="h-8 w-8 text-slate-600" />
                      <p className="text-sm text-slate-400">
                        No agregaste ningún scanner.
                      </p>
                      <Button size="sm" onClick={() => setShowForm(true)}>
                        <Plus className="h-4 w-4" />
                        Invitar mi primer scanner
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {assigningScanner && (
        <Modal
          title={`Asignar eventos a ${assigningScanner.name}`}
          onClose={() => setAssigningId(null)}
        >
          <div className="flex flex-col gap-2">
            {events.map((event) => (
              <label
                key={event.id}
                className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={assigningScanner.assignedEvents.includes(event.id)}
                  onChange={() => toggleEvent(assigningScanner, event.id)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-500"
                />
                {event.name}
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" onClick={() => setAssigningId(null)}>
            Listo
          </Button>
        </Modal>
      )}

      {scannerToDelete && (
        <ConfirmDialog
          title="Eliminar scanner"
          description={`¿Seguro que querés eliminar a "${scannerToDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={confirmDeleteScanner}
          onClose={() => setScannerToDelete(null)}
        />
      )}
    </div>
  );
}
