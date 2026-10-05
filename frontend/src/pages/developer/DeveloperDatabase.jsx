import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Database, CalendarDays, Receipt, Ticket, ScanLine, LogIn, Sprout } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { getDevDatabaseStats, createDemoEvent } from "../../lib/devToolsApi.js";

const STAT_ITEMS = [
  { key: "events", label: "Eventos", icon: CalendarDays },
  { key: "sales", label: "Ventas", icon: Receipt },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "scanners", label: "Scanners", icon: ScanLine },
  { key: "checkIns", label: "Check-ins", icon: LogIn },
];

export default function DeveloperDatabase() {
  const { getToken } = useAuth();
  const toast = useToast();

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);

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
        <div className="grid grid-cols-1 gap-4">
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
    </div>
  );
}
