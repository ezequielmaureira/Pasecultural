import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useToast } from "../../context/ToastContext.jsx";
import { listScannerEvents } from "../../lib/scannerApi.js";
import { readActiveScannerSelection, writeActiveScannerSelection, clearActiveScannerSelection } from "../../lib/scannerStorage.js";
import { functionLabel } from "./scannerFormat.js";
import LoadingScreen from "./screens/LoadingScreen.jsx";
import ReconnectingScreen from "./screens/ReconnectingScreen.jsx";
import EmptyScreen from "./screens/EmptyScreen.jsx";
import ErrorScreen from "./screens/ErrorScreen.jsx";
import EventSelectScreen from "./screens/EventSelectScreen.jsx";
import FunctionSelectScreen from "./screens/FunctionSelectScreen.jsx";
import ReadyScreen from "./screens/ReadyScreen.jsx";
import ScanningScreen from "./screens/ScanningScreen.jsx";

// Máquina de estados de la selección del Scanner. Fases posibles:
//   loading       -> primera carga, sin nada guardado todavía para mostrar
//   reconnecting  -> hay evento/función guardados: se muestran de inmediato
//                    mientras se confirma en segundo plano que sigan válidos
//   select-event  -> más de un evento asignado
//   select-function -> evento elegido (o el único que tiene), más de 1 función
//   ready         -> evento+función resueltos, listo para (la próxima fase) escanear
//   empty         -> sin ninguna asignación activa
//   error/offline -> falló la carga
export default function ScannerHome() {
    const { getToken } = useAuth();
    const toast = useToast();

    const [phase, setPhase] = useState("loading");
    const [cachedSelection, setCachedSelection] = useState(null);
    const [events, setEvents] = useState([]);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [selectedFunction, setSelectedFunction] = useState(null);
    const [errorMessage, setErrorMessage] = useState("");

    const load = useCallback(async () => {
        const stored = readActiveScannerSelection();
        setCachedSelection(stored);
        setPhase(stored ? "reconnecting" : "loading");

        try {
            const token = await getToken();
            const fetchedEvents = await listScannerEvents(token);
            setEvents(fetchedEvents);
            resolveSelection(fetchedEvents, stored);
        } catch (err) {
            if (err.isTimeout || err.isNetworkError) {
                setPhase("offline");
            } else {
                setErrorMessage(err.message || "");
                setPhase("error");
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getToken]);

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
        setPhase("ready");
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
                onExitScanning={() => setPhase("ready")}
                onChangeFunction={() => setPhase("select-function")}
                onRevoked={() => {
                    clearActiveScannerSelection();
                    toast.info("Ya no tenés acceso a este evento.");
                    load();
                }}
            />
        );
    }
    return null;
}
