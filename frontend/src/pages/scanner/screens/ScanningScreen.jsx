import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import QrScanner from "qr-scanner";
import { History } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import { validateScan } from "../../../lib/scannerApi.js";
import { primeAudio, playResultSound } from "../scannerSound.js";
import { vibrateForResult } from "../scannerVibration.js";
import { SCAN_RESULT_DURATION_MS } from "../scanResultConfig.js";
import { functionLabel } from "../scannerFormat.js";
import ScanResultOverlay from "../components/ScanResultOverlay.jsx";
import ScanHistoryDrawer from "../components/ScanHistoryDrawer.jsx";
import CameraErrorScreen from "./CameraErrorScreen.jsx";

function classifyCameraError(err) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
    if (name === "NotReadableError" || name === "TrackStartError") return "busy";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "lost";
    if (!navigator.mediaDevices || !window.isSecureContext) return "unsupported";
    return "unknown";
}

// El corazón del Scanner. Lectura continua con qr-scanner (BarcodeDetector
// nativo si el navegador lo soporta, si no un Web Worker — nunca bloquea
// el hilo principal). Ver justificación de la librería en el mensaje de
// aprobación de esta fase.
export default function ScanningScreen({ event, fn, onExitScanning, onChangeFunction, onRevoked }) {
    const { getToken } = useAuth();
    const videoRef = useRef(null);
    const qrScannerRef = useRef(null);
    const resumeTimeoutRef = useRef(null);
    const busyRef = useRef(false);
    const cameraIndexRef = useRef(0);

    const [cameraStatus, setCameraStatus] = useState("starting"); // starting | active | error
    const [cameraErrorType, setCameraErrorType] = useState(null);
    const [availableCameras, setAvailableCameras] = useState([]);
    const [result, setResult] = useState(null); // { status, data } | null
    const [stats, setStats] = useState({ capacity: fn.capacity, checkedIn: fn.checkedIn, remaining: fn.remaining });
    const [historyOpen, setHistoryOpen] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // Reanudar la lectura es lo único que puede volver a fallar (la cámara
    // se pudo haber desconectado mientras se mostraba el resultado) — por
    // eso está separado y maneja su propio error de cámara.
    const resumeScanning = useCallback(() => {
        setResult(null);
        busyRef.current = false;
        qrScannerRef.current?.start().catch((err) => {
            setCameraErrorType(classifyCameraError(err));
            setCameraStatus("error");
        });
    }, []);

    const handleDecode = useCallback(
        async (scanResult) => {
            if (busyRef.current) return;
            busyRef.current = true;

            // Pausa estructural, no un timer que "ignora" duplicados: apenas se
            // decodifica algo, el motor de QR se detiene por completo. Mientras
            // no está corriendo, es estructuralmente imposible que vuelva a leer
            // el mismo código (o cualquier otro) — no depende de comparar
            // tokens ni de adivinar una ventana de tiempo. Es el mecanismo más
            // robusto posible: la ausencia de lectura, no una lectura ignorada.
            qrScannerRef.current?.stop();

            const qrToken = typeof scanResult === "string" ? scanResult : scanResult.data;

            try {
                const token = await getToken();
                const response = await validateScan(token, { qrToken, eventId: event.id, functionId: fn.id });

                playResultSound(response.status);
                vibrateForResult(response.status);
                if (response.stats) setStats(response.stats);
                setResult({ status: response.status, data: response.data });

                const duration = SCAN_RESULT_DURATION_MS[response.status] ?? SCAN_RESULT_DURATION_MS.NOT_FOUND;
                resumeTimeoutRef.current = setTimeout(resumeScanning, duration);
            } catch (err) {
                if (err.code === "SCANNER_NOT_AUTHORIZED") {
                    onRevoked();
                    return;
                }
                if (err.isTimeout || err.isNetworkError) {
                    setResult({ status: "OFFLINE", data: null });
                    resumeTimeoutRef.current = setTimeout(resumeScanning, SCAN_RESULT_DURATION_MS.OFFLINE);
                    return;
                }
                // Error real inesperado: nunca se muestra técnico — se trata
                // visualmente como NOT_FOUND y se sigue escaneando igual.
                setResult({ status: "NOT_FOUND", data: null });
                resumeTimeoutRef.current = setTimeout(resumeScanning, SCAN_RESULT_DURATION_MS.NOT_FOUND);
            }
        },
        [event.id, fn.id, getToken, onRevoked, resumeScanning]
    );

    const startCamera = useCallback(async () => {
        setCameraStatus("starting");
        setCameraErrorType(null);

        if (!navigator.mediaDevices || !window.isSecureContext) {
            setCameraErrorType("unsupported");
            setCameraStatus("error");
            return;
        }

        try {
            primeAudio();
            if (!qrScannerRef.current) {
                qrScannerRef.current = new QrScanner(videoRef.current, handleDecode, {
                    onDecodeError: () => {}, // se dispara en cada frame sin QR — no es un error real, es el caso normal
                    highlightScanRegion: true,
                    highlightCodeOutline: true,
                    preferredCamera: "environment",
                    maxScansPerSecond: 10,
                });
            }
            await qrScannerRef.current.start();
            setCameraStatus("active");
            QrScanner.listCameras(true)
                .then(setAvailableCameras)
                .catch(() => {});
        } catch (err) {
            setCameraErrorType(classifyCameraError(err));
            setCameraStatus("error");
        }
    }, [handleDecode]);

    useEffect(() => {
        startCamera();
        return () => {
            clearTimeout(resumeTimeoutRef.current);
            qrScannerRef.current?.stop();
            qrScannerRef.current?.destroy();
            qrScannerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function handleOnline() {
            setIsOnline(true);
        }
        function handleOffline() {
            setIsOnline(false);
        }
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    // Detecta que el dispositivo de cámara se desconectó a mitad de una
    // sesión activa (no sólo al abrir/reanudar) — ej. se desenchufó una
    // webcam USB. Sin esto, el video simplemente se congela sin avisar.
    useEffect(() => {
        if (!navigator.mediaDevices?.addEventListener) return undefined;

        async function handleDeviceChange() {
            if (cameraStatus !== "active") return;
            const hasCamera = await QrScanner.hasCamera().catch(() => true);
            if (!hasCamera) {
                qrScannerRef.current?.stop();
                setCameraErrorType("lost");
                setCameraStatus("error");
            }
        }

        navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
        return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    }, [cameraStatus]);

    async function handleSwitchCamera() {
        if (availableCameras.length < 2 || !qrScannerRef.current) return;
        cameraIndexRef.current = (cameraIndexRef.current + 1) % availableCameras.length;
        try {
            await qrScannerRef.current.setCamera(availableCameras[cameraIndexRef.current].id);
        } catch (err) {
            setCameraErrorType(classifyCameraError(err));
            setCameraStatus("error");
        }
    }

    if (cameraStatus === "error") {
        return (
            <CameraErrorScreen
                type={cameraErrorType}
                onRetry={startCamera}
                canSwitchCamera={availableCameras.length > 1}
                onSwitchCamera={handleSwitchCamera}
                onChangeFunction={onChangeFunction}
                onBack={onExitScanning}
            />
        );
    }

    return (
        <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black">
            <div className="relative z-10 flex items-center justify-between gap-3 bg-black/70 px-4 py-3 backdrop-blur-sm">
                <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{event.title}</p>
                    <p className="truncate text-[11px] text-slate-400">{functionLabel(fn)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    <span
                        className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-rose-500"}`}
                        title={isOnline ? "En línea" : "Sin conexión"}
                    />
                    <span className="font-mono text-xs text-white">
                        {stats.checkedIn}
                        <span className="text-slate-500">/{stats.capacity}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setHistoryOpen(true)}
                        aria-label="Ver historial de escaneos"
                        className="text-slate-300 transition-colors duration-150 hover:text-white"
                    >
                        <History className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="relative flex-1 bg-black">
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

                {cameraStatus === "starting" && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
                        <Spinner size="lg" />
                    </div>
                )}

                {result && <ScanResultOverlay status={result.status} data={result.data} />}
            </div>

            {historyOpen && (
                <ScanHistoryDrawer eventId={event.id} functionId={fn.id} onClose={() => setHistoryOpen(false)} />
            )}
        </div>
    );
}
