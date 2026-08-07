import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext.jsx";
import { listScannerEvents, getScannerDashboard } from "../../lib/scannerApi.js";
import { readActiveScannerSelection, writeActiveScannerSelection, clearActiveScannerSelection } from "../../lib/scannerStorage.js";
import { readScannerSessionToken, clearScannerSessionToken } from "../../lib/scannerSessionStorage.js";
import { functionLabel } from "./scannerFormat.js";
import LoadingScreen from "./screens/LoadingScreen.jsx";
import ReconnectingScreen from "./screens/ReconnectingScreen.jsx";
import EmptyScreen from "./screens/EmptyScreen.jsx";
import NoSessionScreen from "./screens/NoSessionScreen.jsx";
import ErrorScreen from "./screens/ErrorScreen.jsx";
import EventSelectScreen from "./screens/EventSelectScreen.jsx";
import FunctionSelectScreen from "./screens/FunctionSelectScreen.jsx";
import ReadyScreen from "./screens/ReadyScreen.jsx";
import ScanningScreen from "./screens/ScanningScreen.jsx";
import DashboardScreen from "./screens/DashboardScreen.jsx";
import ScannerStatsScreen from "./screens/ScannerStatsScreen.jsx";
import ScanHistoryDrawer from "./components/ScanHistoryDrawer.jsx";

// Máquina de estados de la selección del Scanner. Fases posibles:
//   loading       -> primera carga, sin nada guardado todavía para mostrar
//   reconnecting  -> hay evento/función guardados: se muestran de inmediato
//                    mientras se confirma en segundo plano que sigan válidos
//   dashboard     -> pantalla previa (identidad/estado/validadas hoy) — a
//                    dónde aterriza SIEMPRE una sesión válida, antes de
//                    elegir escanear/historial/estadísticas
//   select-event  -> más de un evento asignado
//   select-function -> evento elegido (o el único que tiene), más de 1 función
//   ready         -> evento+función resueltos, listo para escanear
//   scanning      -> lector QR (sin cambios de lógica en este cambio)
//   history       -> últimos escaneos de la función (ScanHistoryDrawer, reusado)
//   stats         -> estadísticas de la función (sólo lectura)
//   empty         -> sin ninguna asignación activa
//   error/offline -> falló la carga
export default function ScannerHome() {
    const navigate = useNavigate();
    const toast = useToast();

    const [phase, setPhase] = useState("loading");
    const [cachedSelection, setCachedSelection] = useState(null);
    const [events, setEvents] = useState([]);
    const [dashboard, setDashboard] = useState(null);
    // Evento cuya información muestra el Dashboard ahora mismo (tarjeta de
    // identidad + selector de arriba cuando hay más de uno) — no es
    // necesariamente `selectedEvent` (ese es el elegido para escanear/ver
    // historial/estadísticas, que puede no coincidir mientras se está
    // resolviendo). `dashboard` siempre corresponde a este id.
    const [activeEventId, setActiveEventId] = useState(null);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [selectedFunction, setSelectedFunction] = useState(null);
    const [errorMessage, setErrorMessage] = useState("");

    // A qué fase ir una vez que select-event/select-function resuelven un
    // evento+función: "scan" (default, va a "ready") | "history" | "stats".
    // No cambia en nada la lógica de resolveSelection/autoSelectOrPrompt/
    // applySelection en sí — sólo el destino final de applySelection.
    const [selectionIntent, setSelectionIntent] = useState("scan");

    // Sin Clerk: la única credencial es el scannerSessionToken guardado al
    // verificar el código — antes sólo por invitación, ahora también por el
    // Portal Scanner (ScannerPortal.jsx). Si el organizador desactivó/
    // revocó/eliminó este scanner mientras tanto, el backend lo rechaza
    // igual con SCANNER_SESSION_INVALID en cada request — acá se limpia el
    // token y se manda a la persona al Portal (no a Home): es el único
    // camino de acceso recurrente de acá en más.
    function exitWithoutSession(message) {
        clearScannerSessionToken();
        clearActiveScannerSelection();
        if (message) toast.info(message);
        navigate("/scanner/portal", { replace: true });
    }

    // Recarga el dashboard de UN evento puntual (no el de carga inicial —
    // ver `load`) y lo deja como activo. Usado al cambiar de evento desde el
    // selector del Dashboard: nunca rompe la pantalla si falla, sólo avisa
    // y deja el dashboard anterior tal cual (mismo criterio que el resto de
    // la app: un fallo de red puntual no debe tirar abajo toda la sesión).
    async function loadDashboardFor(eventId) {
        try {
            const token = readScannerSessionToken();
            const fresh = await getScannerDashboard(token, eventId);
            setDashboard(fresh);
            setActiveEventId(eventId);
        } catch (err) {
            if (err.code === "SCANNER_SESSION_INVALID" || err.code === "SCANNER_NOT_AUTHORIZED") {
                exitWithoutSession("Tu sesión de scanner venció o ya no es válida.");
                return;
            }
            toast.error(err.message || "No pudimos actualizar la información de ese evento.");
        }
    }

    const load = useCallback(async () => {
        const sessionToken = readScannerSessionToken();
        if (!sessionToken) {
            setPhase("no-session");
            return;
        }

        const stored = readActiveScannerSelection();
        setCachedSelection(stored);
        setPhase(stored ? "reconnecting" : "loading");

        try {
            const [{ events: fetchedEvents }, anchorDashboard] = await Promise.all([
                listScannerEvents(sessionToken),
                getScannerDashboard(sessionToken), // sin eventId: el ancla, exactamente como siempre
            ]);
            setEvents(fetchedEvents);

            // Si hay más de un evento y ya había una preferencia guardada
            // distinta al ancla, se respeta — es el único caso que paga una
            // consulta extra (getScannerDashboard de ese evento puntual). En
            // cualquier otro caso (un solo evento, o sin preferencia
            // guardada, o la preferencia coincide con el ancla) se reusa
            // directamente `anchorDashboard`: cero consultas de más.
            const preferredEventId =
                fetchedEvents.length > 1 && stored?.eventId && fetchedEvents.some((e) => e.id === stored.eventId)
                    ? stored.eventId
                    : anchorDashboard.eventId;

            if (preferredEventId === anchorDashboard.eventId) {
                setDashboard(anchorDashboard);
                setActiveEventId(anchorDashboard.eventId);
            } else {
                try {
                    const preferredDashboard = await getScannerDashboard(sessionToken, preferredEventId);
                    setDashboard(preferredDashboard);
                    setActiveEventId(preferredEventId);
                } catch {
                    // La preferencia guardada ya no es válida, o falló la
                    // consulta puntual: se cae al ancla en vez de dejar el
                    // Dashboard sin nada que mostrar. El selector de arriba
                    // sigue permitiendo elegir cualquier evento igual.
                    setDashboard(anchorDashboard);
                    setActiveEventId(anchorDashboard.eventId);
                }
            }

            // Toda sesión válida aterriza en el Dashboard primero — la
            // resolución de evento/función (resolveSelection) ya no corre
            // sola al cargar, sólo cuando la persona elige una acción.
            setPhase("dashboard");
        } catch (err) {
            if (err.code === "SCANNER_SESSION_INVALID") {
                exitWithoutSession("Tu sesión de scanner venció o ya no es válida.");
                return;
            }
            if (err.isTimeout || err.isNetworkError) {
                setPhase("offline");
            } else {
                setErrorMessage(err.message || "");
                setPhase("error");
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Si se queda en la pantalla de "sin conexión", reintenta solo apenas
    // el navegador avisa que volvió la conexión — no hace falta que el
    // operador toque nada.
    useEffect(() => {
        if (phase !== "offline") return undefined;
        function handleOnline() {
            load();
        }
        window.addEventListener("online", handleOnline);
        return () => window.removeEventListener("online", handleOnline);
    }, [phase, load]);

    function resolveSelection(fetchedEvents, stored) {
        if (fetchedEvents.length === 0) {
            clearActiveScannerSelection();
            setPhase("empty");
            return;
        }

        if (stored) {
            const event = fetchedEvents.find((e) => e.id === stored.eventId);
            if (!event) {
                clearActiveScannerSelection();
                toast.info("Ya no tenés acceso a ese evento.");
                autoSelectOrPrompt(fetchedEvents);
                return;
            }
            if (!stored.functionId) {
                // Evento guardado (elegido desde el selector del Dashboard)
                // sin una función todavía — mismo camino que elegirlo a
                // mano: auto-aplica si tiene una sola función, si no pide
                // elegir. Nunca es "función ya no disponible": acá nunca
                // hubo ninguna guardada.
                handleSelectEvent(event);
                return;
            }
            const fn = event.functions.find((f) => f.id === stored.functionId);
            if (!fn) {
                clearActiveScannerSelection();
                toast.info("Esa función ya no está disponible.");
                autoSelectOrPrompt(fetchedEvents);
                return;
            }
            applySelection(event, fn, { persist: false });
            return;
        }

        autoSelectOrPrompt(fetchedEvents);
    }

    function autoSelectOrPrompt(fetchedEvents) {
        if (fetchedEvents.length === 1 && fetchedEvents[0].functions.length === 1) {
            applySelection(fetchedEvents[0], fetchedEvents[0].functions[0], { persist: true });
            return;
        }
        if (fetchedEvents.length === 1) {
            setSelectedEvent(fetchedEvents[0]);
            setPhase("select-function");
            return;
        }
        setPhase("select-event");
    }

    function applySelection(event, fn, { persist }) {
        setSelectedEvent(event);
        setSelectedFunction(fn);
        if (persist) {
            writeActiveScannerSelection({
                eventId: event.id,
                functionId: fn.id,
                eventName: event.title,
                functionName: functionLabel(fn),
            });
        }
        // Cualquier resolución de evento+función (venga de "Escanear",
        // "Historial", "Estadísticas", o de "Cambiar evento" a mitad de
        // flujo) deja al Dashboard mostrando la información de ESE evento —
        // así la puerta que ve ScanningScreen y la tarjeta a la que se
        // vuelve después nunca quedan desincronizadas del evento realmente
        // activo. Sólo dispara la consulta si de verdad cambió.
        if (event.id !== activeEventId) {
            loadDashboardFor(event.id);
        }
        setPhase(selectionIntent === "scan" ? "ready" : selectionIntent);
    }

    function handleSelectEvent(event) {
        if (event.functions.length === 1) {
            applySelection(event, event.functions[0], { persist: true });
            return;
        }
        setSelectedEvent(event);
        setPhase("select-function");
    }

    function handleSelectFunction(fn) {
        applySelection(selectedEvent, fn, { persist: true });
    }

    // Botón principal del Dashboard — reutiliza tal cual la cadena ya
    // existente (resolveSelection -> autoSelectOrPrompt/select-event/
    // select-function -> ready -> scanning), conservando la última función
    // elegida igual que antes.
    function handleStartScanning() {
        setSelectionIntent("scan");
        resolveSelection(events, readActiveScannerSelection());
    }

    // "Historial"/"Estadísticas": parten SIEMPRE del evento que el
    // Dashboard está mostrando ahora mismo (activeEventId) — nunca vuelven
    // a preguntar qué evento, ya se eligió arriba. Van directo a la función
    // si sólo hay una, si no piden elegir (mismas pantallas de selección ya
    // existentes) — pero a diferencia de "Escanear", nunca se auto-recuerda
    // una función anterior para esto, ni se persiste la que se auto-aplique.
    function startViewingActiveEvent() {
        const event = events.find((e) => e.id === activeEventId) ?? events[0];
        if (!event) return;
        if (event.functions.length === 1) {
            applySelection(event, event.functions[0], { persist: false });
            return;
        }
        setSelectedEvent(event);
        setPhase("select-function");
    }

    function handleOpenHistory() {
        setSelectionIntent("history");
        startViewingActiveEvent();
    }

    function handleOpenStats() {
        setSelectionIntent("stats");
        startViewingActiveEvent();
    }

    // Selector de evento arriba del Dashboard (sólo se muestra si hay más
    // de uno asignado — ver DashboardScreen.jsx). Nunca navega a otra
    // pantalla: sólo recarga `dashboard` para el evento elegido y lo
    // recuerda (mismo storage que ya usa el flujo de escaneo, sin
    // functionId todavía — ver scannerStorage.js).
    function handleSelectDashboardEvent(event) {
        if (event.id === activeEventId) return;
        writeActiveScannerSelection({ eventId: event.id, eventName: event.title });
        loadDashboardFor(event.id);
    }

    function handleLogout() {
        exitWithoutSession();
    }

    if (phase === "loading") return <LoadingScreen />;
    if (phase === "reconnecting") {
        return <ReconnectingScreen eventName={cachedSelection?.eventName} functionName={cachedSelection?.functionName} />;
    }
    if (phase === "offline") {
        return cachedSelection ? (
            <ReconnectingScreen eventName={cachedSelection.eventName} functionName={cachedSelection.functionName} offline />
        ) : (
            <ErrorScreen offline onRetry={load} />
        );
    }
    if (phase === "error") return <ErrorScreen message={errorMessage} onRetry={load} />;
    if (phase === "no-session") return <NoSessionScreen />;
    if (phase === "dashboard" && dashboard) {
        return (
            <DashboardScreen
                dashboard={dashboard}
                events={events}
                activeEventId={activeEventId}
                onSelectEvent={handleSelectDashboardEvent}
                onStartScanning={handleStartScanning}
                onOpenHistory={handleOpenHistory}
                onOpenStats={handleOpenStats}
                onLogout={handleLogout}
            />
        );
    }
    if (phase === "empty") return <EmptyScreen />;
    if (phase === "select-event") return <EventSelectScreen events={events} onSelect={handleSelectEvent} />;
    if (phase === "select-function") {
        return (
            <FunctionSelectScreen
                event={selectedEvent}
                onSelect={handleSelectFunction}
                onBack={events.length > 1 ? () => setPhase("select-event") : undefined}
            />
        );
    }
    if (phase === "ready") {
        return (
            <ReadyScreen
                event={selectedEvent}
                fn={selectedFunction}
                canChangeFunction={selectedEvent.functions.length > 1}
                onChangeFunction={() => setPhase("select-function")}
                canChangeEvent={events.length > 1}
                onChangeEvent={() => setPhase("select-event")}
                onStartScanning={() => setPhase("scanning")}
            />
        );
    }
    if (phase === "scanning") {
        return (
            <ScanningScreen
                event={selectedEvent}
                fn={selectedFunction}
                scannerGate={dashboard?.gate ?? dashboard?.name ?? ""}
                onExitScanning={() => setPhase("ready")}
                onChangeFunction={() => setPhase("select-function")}
                onRevoked={() => exitWithoutSession("Ya no tenés acceso como scanner de este evento.")}
                onLogout={handleLogout}
            />
        );
    }
    if (phase === "history") {
        return <ScanHistoryDrawer eventId={selectedEvent.id} functionId={selectedFunction.id} onClose={() => setPhase("dashboard")} />;
    }
    if (phase === "stats") {
        return <ScannerStatsScreen event={selectedEvent} fn={selectedFunction} onBack={() => setPhase("dashboard")} />;
    }
    return null;
}
