import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  Plus,
  ScanLine,
  AlertTriangle,
  RefreshCw,
  Pencil,
  Ban,
  Power,
  RotateCcw,
  Trash2,
  RefreshCcw as RegenerateIcon,
  Share2,
} from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useActiveEvent } from "../../context/ActiveEventContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { getScannerHealth } from "../../components/organizer/scannerHealth.js";
import { formatRelativeTime } from "../../lib/format.js";
import {
  listEventScanners,
  disableScanner,
  reactivateScanner,
  revokeScannerInvitation,
  regenerateScannerInvitation,
  deleteScanner,
  updateScanner,
} from "../../lib/eventScannerApi.js";
import ShareInvitationCard from "./scannerChat/ShareInvitationCard.jsx";

const STATUS_CONFIG = {
  INVITED: { label: "Invitado", tone: "bg-sky-500/10 text-sky-400" },
  ACTIVE: { label: "Activo", tone: "bg-emerald-500/10 text-emerald-400" },
  DISABLED: { label: "Desactivado", tone: "bg-slate-500/10 text-slate-400" },
  REVOKED: { label: "Revocado", tone: "bg-rose-500/10 text-rose-400" },
};

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.INVITED;
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.tone}`}>
      {config.label}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

// Se muestra lo que la persona completó en el registro (firstName/lastName
// de EventScanner), no lo que eventualmente diga `user` — `user` puede ser
// una cuenta ya existente adoptada por email con otro nombre guardado.
function scannerPersonLabel(scanner) {
  if (!scanner.firstName) return "Sin registrar todavía";
  return [scanner.firstName, scanner.lastName].filter(Boolean).join(" ") || scanner.email;
}

// Formulario de "Editar nombre/puerta" — un solo Modal para ambos campos a
// la vez en vez de dos acciones separadas, son parte del mismo registro.
function EditScannerModal({ scanner, onClose, onSaved }) {
  const { getToken } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(scanner.name);
  const [gate, setGate] = useState(scanner.gate);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      const updated = await updateScanner(token, scanner.eventId, scanner.id, { name, gate });
      toast.success("Scanner actualizado.");
      onSaved(updated);
    } catch (err) {
      toast.error(err.message || "No pudimos guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar scanner" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Nombre">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Puerta / acceso">
          <input className={inputClass} value={gate} onChange={(e) => setGate(e.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving} loadingText="Guardando...">
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ScannerActionButton({ icon: Icon, label, onClick, danger, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "text-rose-400 hover:bg-rose-500/10" : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// Una tarjeta por scanner — con las columnas que pide la gestión (nombre,
// puerta, estado, fecha, último acceso, dispositivo) y sólo las acciones
// válidas para SU estado actual — el backend también lo valida, esto es
// sólo para no mostrar botones que van a fallar.
//
// El semáforo de salud (verde/amarillo/rojo/gris, `getScannerHealth`) y los
// ingresos/último escaneo vivían antes en una lista aparte del Dashboard
// (ScannerStatusList) — se integraron acá para que "Scanners" sea el único
// lugar con toda la información de un scanner, gestión y estado juntos, en
// vez de tener dos representaciones distintas del mismo scanner en dos
// pantallas. `StatusBadge` (ciclo de vida: Invitado/Activo/Desactivado/
// Revocado) y la salud son cosas distintas a propósito — ver
// scannerHealth.js: un scanner puede estar ACTIVE y aun así "sin actividad
// hace unos minutos".
function ScannerCard({ scanner, now, onAction, actingId, onEdit, onShare }) {
  const isActing = actingId === scanner.id;
  const health = getScannerHealth(scanner, now);

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">{scanner.name}</p>
            <p className="text-xs text-slate-500">{scanner.gate}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge status={scanner.status} />
            <Badge tone={health.tone}>{health.label}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-3">
          <p>
            <span className="text-slate-500">Persona: </span>
            {scannerPersonLabel(scanner)}
          </p>
          {scanner.document && (
            <p>
              <span className="text-slate-500">DNI: </span>
              {scanner.document}
            </p>
          )}
          {scanner.phone && (
            <p>
              <span className="text-slate-500">Teléfono: </span>
              {scanner.phone}
            </p>
          )}
          <p>
            <span className="text-slate-500">Creado: </span>
            {formatDateTime(scanner.createdAt)}
          </p>
          <p>
            <span className="text-slate-500">Último acceso: </span>
            {formatDateTime(scanner.lastAccessAt)}
          </p>
          <p>
            <span className="text-slate-500">Ingresos validados: </span>
            {scanner.checkInsCount ?? 0}
          </p>
          <p>
            <span className="text-slate-500">Último escaneo: </span>
            {scanner.lastScanAt ? formatRelativeTime(scanner.lastScanAt, now) : "—"}
          </p>
          {scanner.lastDevice && (
            <p className="truncate sm:col-span-3">
              <span className="text-slate-500">Dispositivo: </span>
              {scanner.lastDevice}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1 border-t border-white/5 pt-3">
          {scanner.status === "INVITED" && (
            <ScannerActionButton icon={Share2} label="Compartir" onClick={() => onShare(scanner)} loading={isActing} />
          )}
          {scanner.status === "ACTIVE" && (
            <ScannerActionButton icon={Power} label="Desactivar" onClick={() => onAction(scanner, "disable")} loading={isActing} />
          )}
          {scanner.status === "DISABLED" && (
            <ScannerActionButton icon={RotateCcw} label="Reactivar" onClick={() => onAction(scanner, "reactivate")} loading={isActing} />
          )}
          {(scanner.status === "INVITED" || scanner.status === "REVOKED") && (
            <ScannerActionButton icon={RegenerateIcon} label="Nueva invitación" onClick={() => onAction(scanner, "regenerate")} loading={isActing} />
          )}
          {scanner.status !== "REVOKED" && (
            <ScannerActionButton icon={Ban} label="Revocar" danger onClick={() => onAction(scanner, "revoke")} loading={isActing} />
          )}
          <ScannerActionButton icon={Pencil} label="Editar" onClick={() => onEdit(scanner)} loading={isActing} />
          <ScannerActionButton icon={Trash2} label="Eliminar" danger onClick={() => onAction(scanner, "delete")} loading={isActing} />
        </div>
      </div>
    </Card>
  );
}

// Reemplaza por completo el formulario "email de alguien que ya tiene
// cuenta" (addEventScanner) por la gestión del ciclo de vida completo de
// invitaciones — crear se hace en el asistente conversacional
// (ScannerInviteChat, ver /organizador/scanners/nuevo), acá sólo se
// administra lo ya creado.
export default function OrganizerScanners() {
  const { getToken } = useAuth();
  const { events, loadingEvents } = useOrganizerData();
  const { activeEventId, setActiveEventId } = useActiveEvent();
  const toast = useToast();

  const [eventId, setEventId] = useState("");
  const [scanners, setScanners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { scanner, action }
  const [editingScanner, setEditingScanner] = useState(null);
  const [sharingScanner, setSharingScanner] = useState(null);

  // Para el semáforo de salud (getScannerHealth) y las fechas relativas de
  // "último escaneo" — un solo valor por render alcanza, esta pantalla no
  // pollea en vivo (a diferencia del Dashboard).
  const now = new Date();

  // Default: el Evento Activo compartido si sigue siendo válido; si no, el
  // primero disponible (mismo criterio de antes).
  useEffect(() => {
    if (loadingEvents || events.length === 0 || eventId) return;
    const validActive = activeEventId && events.some((e) => e.id === activeEventId) ? activeEventId : null;
    setEventId(validActive ?? events[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingEvents, events, eventId]);

  async function loadScanners(id) {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const list = await listEventScanners(token, id);
      setScanners(list.map((s) => ({ ...s, eventId: id })));
    } catch (err) {
      setError(err.message || "No pudimos cargar los scanners de este evento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (eventId) loadScanners(eventId);
  }, [eventId]);

  const ACTION_HANDLERS = {
    disable: (token, scanner) => disableScanner(token, scanner.eventId, scanner.id),
    reactivate: (token, scanner) => reactivateScanner(token, scanner.eventId, scanner.id),
    regenerate: (token, scanner) => regenerateScannerInvitation(token, scanner.eventId, scanner.id),
  };
  const CONFIRM_ACTIONS = new Set(["revoke", "delete"]);
  const ACTION_MESSAGES = {
    revoke: { title: "Revocar", description: "Se cancela la invitación o el acceso de este scanner de inmediato." },
    delete: { title: "Eliminar scanner", description: "Se saca de la lista. Esta acción no se puede deshacer desde acá." },
  };

  async function runAction(scanner, action) {
    setActingId(scanner.id);
    try {
      const token = await getToken();
      if (action === "revoke") await revokeScannerInvitation(token, scanner.eventId, scanner.id);
      else if (action === "delete") await deleteScanner(token, scanner.eventId, scanner.id);
      else await ACTION_HANDLERS[action](token, scanner);
      toast.success("Listo.");
      loadScanners(eventId);
    } catch (err) {
      toast.error(err.message || "No pudimos completar la acción.");
    } finally {
      setActingId(null);
      setConfirmAction(null);
    }
  }

  function handleAction(scanner, action) {
    if (CONFIRM_ACTIONS.has(action)) {
      setConfirmAction({ scanner, action });
      return;
    }
    runAction(scanner, action);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Scanners</h1>
          <p className="text-sm text-slate-400">Invitá y administrá quién puede validar entradas.</p>
        </div>
        {events.length > 0 && (
          <Link to="/organizador/scanners/nuevo">
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              Agregar scanner
            </Button>
          </Link>
        )}
      </div>

      {!loadingEvents && events.length === 0 && (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ScanLine className="h-6 w-6 text-slate-600" />
            <p className="text-sm text-slate-400">Creá un evento primero para poder invitar scanners.</p>
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <>
          <Field label="Evento" className="max-w-sm">
            <select
              className={inputClass}
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setActiveEventId(e.target.value); // el resto de las pantallas heredan esta elección
              }}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </Field>

          {loading && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 w-full animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          )}

          {!loading && error && (
            <Card>
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertTriangle className="h-6 w-6 text-rose-400" />
                <p className="text-sm text-slate-400">{error}</p>
                <Button size="sm" variant="secondary" onClick={() => loadScanners(eventId)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reintentar
                </Button>
              </div>
            </Card>
          )}

          {!loading && !error && scanners.length === 0 && (
            <Card>
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <ScanLine className="h-8 w-8 text-slate-600" />
                <p className="text-sm text-slate-400">Todavía no invitaste a nadie para escanear este evento.</p>
                <Link to="/organizador/scanners/nuevo">
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    Agregar scanner
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {!loading && !error && scanners.length > 0 && (
            <div className="flex flex-col gap-3">
              {scanners.map((scanner) => (
                <ScannerCard
                  key={scanner.id}
                  scanner={scanner}
                  now={now}
                  actingId={actingId}
                  onAction={handleAction}
                  onEdit={setEditingScanner}
                  onShare={setSharingScanner}
                />
              ))}
            </div>
          )}
        </>
      )}

      {editingScanner && (
        <EditScannerModal
          scanner={editingScanner}
          onClose={() => setEditingScanner(null)}
          onSaved={() => {
            setEditingScanner(null);
            loadScanners(eventId);
          }}
        />
      )}

      {sharingScanner && (
        <Modal title="Compartir invitación" onClose={() => setSharingScanner(null)}>
          <ShareInvitationCard scanner={sharingScanner} />
        </Modal>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={ACTION_MESSAGES[confirmAction.action].title}
          description={ACTION_MESSAGES[confirmAction.action].description}
          confirmLabel={ACTION_MESSAGES[confirmAction.action].title}
          danger
          loading={actingId === confirmAction.scanner.id}
          onConfirm={() => runAction(confirmAction.scanner, confirmAction.action)}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
