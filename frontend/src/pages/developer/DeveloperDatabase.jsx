import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  Database,
  CalendarDays,
  Receipt,
  Ticket,
  ScanLine,
  LogIn,
  Trash2,
  Sprout,
  AlertTriangle,
} from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { getDevDatabaseStats, resetDevDatabase, createDemoEvent } from "../../lib/devToolsApi.js";

const RESET_CONFIRMATION_PHRASE = "REINICIAR";

const STAT_ITEMS = [
  { key: "events", label: "Eventos", icon: CalendarDays },
  { key: "sales", label: "Ventas", icon: Receipt },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "scanners", label: "Scanners", icon: ScanLine },
  { key: "checkIns", label: "Check-ins", icon: LogIn },
];

// Segunda confirmación de "Reiniciar base de desarrollo": a diferencia de
// ConfirmDialog (un botón sí/no), acá hace falta tipear la frase exacta
// para habilitar el botón — mismo criterio que ya valida el backend
// (RESET_CONFIRMATION_PHRASE en devTools.service.js), nunca alcanza con un
// solo click. Se arma sobre Modal/Button ya existentes, no sobre un
// componente nuevo genérico: es un patrón de un solo uso en toda la app.
function TypeToConfirmDialog({ phrase, onConfirm, onClose, loading }) {
  const [value, setValue] = useState("");
  const matches = value.trim() === phrase;

  return (
    <Modal title="Confirmación final" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <p className="text-sm text-slate-300">
            Escribí <span className="font-mono font-semibold text-white">{phrase}</span> para confirmar. Esta
            acción no se puede deshacer.
          </p>
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={phrase}
          disabled={loading}
          className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-sm text-gray-100 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!matches || loading}
            loading={loading}
            loadingText="Eliminando..."
            className="bg-rose-600 text-white hover:bg-rose-500"
          >
            Reiniciar base de desarrollo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function DeveloperDatabase() {
  const { getToken } = useAuth();
  const toast = useToast();

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [resetStep, setResetStep] = useState(null); // null | "warn" | "type"
  const [resetting, setResetting] = useState(false);

  const [creatingDemo, setCreatingDemo] = useState(false);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    setStatsError(false);
    try {
      const token = await getToken();
      const data = await getDevDatabaseStats(token);
      setStats(data);
    } catch (error) {
      console.error("No se pudieron cargar las estadísticas de la base", error);
      setStatsError(true);
    } finally {
      setLoadingStats(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function confirmReset() {
    setResetting(true);
    try {
      const token = await getToken();
      const deleted = await resetDevDatabase(token, RESET_CONFIRMATION_PHRASE);
      const totalDeleted = Object.values(deleted).reduce((sum, n) => sum + n, 0);
      toast.success(`Base de desarrollo reiniciada — se eliminaron ${totalDeleted} registros en total.`);
      setResetStep(null);
      await loadStats();
    } catch (error) {
      toast.error(error.message || "No se pudo reiniciar la base de desarrollo.");
    } finally {
      setResetting(false);
    }
  }

  async function handleCreateDemo() {
    setCreatingDemo(true);
    try {
      const token = await getToken();
      const event = await createDemoEvent(token);
      toast.success(`Se creó "${event.title}" como borrador.`);
      await loadStats();
    } catch (error) {
      toast.error(error.message || "No se pudo crear el evento demo.");
    } finally {
      setCreatingDemo(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <Database className="h-5 w-5 text-slate-400" aria-hidden="true" />
          Base de Datos
        </h1>
        <p className="text-sm text-slate-400">
          Herramienta exclusiva para desarrollo — nunca está disponible en producción.
        </p>
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-white">Información</h2>
        {statsError ? (
          <InlineErrorNotice message="No pudimos cargar la información de la base." onRetry={loadStats} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {STAT_ITEMS.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </div>
                {loadingStats ? (
                  <SkeletonBlock className="mt-3 h-7 w-16" />
                ) : (
                  <p className="mt-3 text-2xl font-bold text-white">{stats?.[key] ?? 0}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-white">Acciones</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-start gap-3">
              <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">Reiniciar base de desarrollo</p>
                <p className="mt-1 text-xs text-slate-500">
                  Elimina todos los datos transaccionales (eventos, ventas, tickets, scanners, check-ins,
                  auditoría). Usuarios y organizaciones no se tocan.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  onClick={() => setResetStep("warn")}
                >
                  Reiniciar base de desarrollo
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-3">
              <Sprout className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">Crear evento demo</p>
                <p className="mt-1 text-xs text-slate-500">
                  Genera un evento en borrador con una función y dos tipos de entrada (General/VIP) para
                  empezar a probar de inmediato.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  loading={creatingDemo}
                  loadingText="Creando..."
                  onClick={handleCreateDemo}
                >
                  Crear evento demo
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {resetStep === "warn" && (
        <ConfirmDialog
          title="¿Reiniciar la base de desarrollo?"
          description="Esta acción eliminará todos los datos transaccionales de la base de desarrollo (eventos, funciones, tipos de entrada, ventas, tickets, scanners, check-ins y auditoría). Los usuarios y las organizaciones NO se van a borrar. No se puede deshacer."
          confirmLabel="Sí, continuar"
          danger
          onConfirm={() => setResetStep("type")}
          onClose={() => setResetStep(null)}
        />
      )}

      {resetStep === "type" && (
        <TypeToConfirmDialog
          phrase={RESET_CONFIRMATION_PHRASE}
          loading={resetting}
          onConfirm={confirmReset}
          onClose={() => setResetStep(null)}
        />
      )}
    </div>
  );
}
