import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { History, SwitchCamera, Zap, ZapOff, LogOut, WifiOff } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import { validateScan } from "../../../lib/scannerApi.js";
import { readScannerSessionToken } from "../../../lib/scannerSessionStorage.js";
import { primeAudio, playResultSound } from "../scannerSound.js";
import { vibrateForResult } from "../scannerVibration.js";
import { SCAN_RESULT_DURATION_MS } from "../scanResultConfig.js";
import { functionLabel } from "../scannerFormat.js";
import ScanResultOverlay from "../components/ScanResultOverlay.jsx";
import ScanHistoryDrawer from "../components/ScanHistoryDrawer.jsx";
import CameraErrorScreen from "./CameraErrorScreen.jsx";

// Mismo QR reenmarcado por accidente (la persona no bajó el teléfono a
// tiempo, o el operador quedó apuntando mientras el grupo avanza) se
// ignora sin volver a golpear el backend — la cámara NUNCA se detiene para
// lograr esto (a diferencia del diseño anterior), es sólo un filtro por
// contenido+tiempo antes de decidir si vale la pena procesar la lectura.
const DUPLICATE_IGNORE_MS = 3000;

function classifyCameraError(err) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
    if (name === "NotReadableError" || name === "TrackStartError") return "busy";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "lost";
    if (!navigator.mediaDevices || !window.isSecureContext) return "unsupported";
    return "unknown";
}

// El corazón del Scanner. Lectura CONTINUA con qr-scanner (BarcodeDetector
// nativo si el navegador lo soporta, si no un Web Worker — nunca bloquea
// el hilo principal). La cámara arranca una sola vez al montar y no se
// vuelve a detener/reiniciar por ningún resultado de escaneo — pensado
// para validar cientos/miles de entradas seguidas sin fricción.
export default function ScanningScreen({ event, fn, scannerGate, onExitScanning, onChangeFunction, onRevoked, onLogout }) {
    const videoRef = useRef(null);
    const qrScannerRef = useRef(null);
    const resultTimeoutRef = useRef(null);
    const busyRef = useRef(false);
    const cameraIndexRef = useRef(0);
    const isMountedRef = useRef(true);
    const isOnlineRef = useRef(navigator.onLine);
    // token crudo del QR -> timestamp del último procesamiento real (no se
    // limpia con un interval propio: se poda de paso en cada decode nuevo,
    // así nunca crece sin límite durante un evento de varias horas).
    const recentTokensRef = useRef(new Map());

    const [cameraStatus, setCameraStatus] = useState("starting"); // starting | active | error
    const [cameraErrorType, setCameraErrorType] = useState(null);
    const [availableCameras, setAvailableCameras] = useState([]);
    const [result, setResult] = useState(null); // { status, data } | null
    const [stats, setStats] = useState({ capacity: fn.capacity, checkedIn: fn.checkedIn, remaining: fn.remaining });
    const [rejectedCount, setRejectedCount] = useState(0);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [hasFlash, setHasFlash] = useState(false);
    const [flashOn, setFlashOn] = useState(false);

    function showResult(status, data) {
        if (!isMountedRef.current) return;
        clearTimeout(resultTimeoutRef.current);
        setResult({ status, data });
        const duration = SCAN_RESULT_DURATION_MS[status] ?? SCAN_RESULT_DURATION_MS.NOT_FOUND;
        // No pausa/reanuda el motor de lectura — sólo esconde el overlay. Si
        // ya entró un resultado más nuevo mientras tanto, este timeout viejo
        // ya fue cancelado arriba por el clearTimeout de la próxima llamada.
        resultTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) setResult(null);
        }, duration);
    }

    const handleDecode = useCallback(
        async (scanResult) => {
            const qrToken = typeof scanResult === "string" ? scanResult : scanResult.data;
            if (!qrToken) return;

            const now = Date.now();
            const recent = recentTokensRef.current;
            // Poda oportunista: nunca un interval propio, se limpia sola en
            // cada lectura nueva.
            for (const [key, ts] of recent) {
                if (now - ts > DUPLICATE_IGNORE_MS) recent.delete(key);
            }
            const lastSeen = recent.get(qrToken);
            if (lastSeen && now - lastSeen < DUPLICATE_IGNORE_MS) return; // mismo QR todavía en cuadro: se ignora, sin tocar el backend

            if (busyRef.current) return; // ya hay una validación en curso, no se solapan requests
            recent.set(qrToken, now);

            if (!isOnlineRef.current) {
                showResult("OFFLINE", null);
                return;
            }

            busyRef.current = true;
            try {
                const token = readScannerSessionToken();
                const response = await validateScan(token, { qrToken, eventId: event.id, functionId: fn.id });

                playResultSound(response.status);
                vibrateForResult(response.status);
                if (isMountedRef.current) {
                    if (response.stats) setStats(response.stats);
                    if (response.status !== "VALID") setRejectedCount((n) => n + 1);
                    showResult(response.status, response.data);
                }
            } catch (err) {
                if (err.code === "SCANNER_NOT_AUTHORIZED" || err.code === "SCANNER_SESSION_INVALID") {
                    onRevoked();
                    return;
                }
                if (err.isTimeout || err.isNetworkError) {
                    showResult("OFFLINE", null);
                } else {
                    // Error real inesperado: nunca se muestra técnico — se trata
                    // visualmente como NOT_FOUND y se sigue escaneando igual.
                    setRejectedCount((n) => n + 1);
                    showResult("NOT_FOUND", null);
                }
            } finally {
                busyRef.current = false;
            }
        },
        [event.id, fn.id, onRevoked]
    );

    // El motor qr-scanner se crea UNA sola vez (ver startCamera más abajo) y
    // llama siempre a esta misma función wrapper — nunca hay que recrear la
    // cámara para que la lectura "vea" un handleDecode actualizado.
    const handleDecodeRef = useRef(handleDecode);
    useEffect(() => {
        handleDecodeRef.current = handleDecode;
    }, [handleDecode]);

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
                qrScannerRef.current = new QrScanner(videoRef.current, (r) => handleDecodeRef.current(r), {
                    onDecodeError: () => {}, // se dispara en cada frame sin QR — no es un error real, es el caso normal
                    highlightScanRegion: true,
                    highlightCodeOutline: true,
                    preferredCamera: "environment",
                    maxScansPerSecond: 10,
                });
            }
            await qrScannerRef.current.start();
            setCameraStatus("active");
            qrScannerRef.current
                .hasFlash()
                .then((supported) => {
                    if (isMountedRef.current) setHasFlash(supported);
                })
                .catch(() => {});
            // Evitar setState si el componente ya fue desmontado mientras
            // resolvía la lista de cámaras.
            QrScanner.listCameras(true)
                .then((cameras) => {
                    if (isMountedRef.current) setAvailableCameras(cameras);
                })
                .catch(() => {});
        } catch (err) {
            setCameraErrorType(classifyCameraError(err));
            setCameraStatus("error");
        }
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        startCamera();
        return () => {
            isMountedRef.current = false;
            clearTimeout(resultTimeoutRef.current);
            qrScannerRef.current?.stop();
            qrScannerRef.current?.destroy();
            qrScannerRef.current = null;
            // Asegurarse de liberar cualquier MediaStream asociado al <video>
            try {
                const stream = videoRef.current?.srcObject;
                if (stream && stream.getTracks) {
                    stream.getTracks().forEach((t) => t.stop());
                }
                if (videoRef.current) videoRef.current.srcObject = null;
            } catch {
                // No romper si el browser ya liberó el stream.
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // "Si se pierde Internet: no intentar validar" — se chequea ANTES de
    // llamar al backend (isOnlineRef, leído dentro de handleDecode), no
    // sólo reactivamente cuando el fetch ya falló. Vuelve a intentar solo
    // cuando el navegador avisa que la conexión volvió.
    useEffect(() => {
        function handleOnline() {
            isOnlineRef.current = true;
            setIsOnline(true);
        }
        function handleOffline() {
            isOnlineRef.current = false;
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
            setFlashOn(false);
            qrScannerRef.current
                .hasFlash()
                .then((supported) => {
                    if (isMountedRef.current) setHasFlash(supported);
                })
                .catch(() => {});
        } catch (err) {
            setCameraErrorType(classifyCameraError(err));
            setCameraStatus("error");
        }
    }

    async function handleToggleFlash() {
        if (!qrScannerRef.current) return;
        try {
            await qrScannerRef.current.toggleFlash();
            setFlashOn(qrScannerRef.current.isFlashOn());
        } catch {
            // Algunos dispositivos anuncian hasFlash() pero fallan al
            // togglear (Safari/iOS es el caso típico) — no rompe la lectura.
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
            <div className="relative z-10 flex flex-col gap-2 bg-black/70 px-4 py-3 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{event.title}</p>
                        <p className="truncate text-[11px] text-slate-400">
                            {functionLabel(fn)}
                            {scannerGate ? ` · ${scannerGate}` : ""}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {!isOnline && (
                            <span className="flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                                <WifiOff className="h-3 w-3" />
                                Sin conexión
                            </span>
                        )}
                        <span
                            className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-rose-500"}`}
                            title={isOnline ? "En línea" : "Sin conexión"}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-emerald-400">
                            ✓ {stats.checkedIn}
                            <span className="text-slate-500">/{stats.capacity}</span>
                        </span>
                        <span className="text-rose-400">✕ {rejectedCount}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {availableCameras.length > 1 && (
                            <button
                                type="button"
                                onClick={handleSwitchCamera}
                                aria-label="Cambiar cámara"
                                className="text-slate-300 transition-colors duration-150 hover:text-white"
                            >
                                <SwitchCamera className="h-4 w-4" />
                            </button>
                        )}
                        {hasFlash && (
                            <button
                                type="button"
                                onClick={handleToggleFlash}
                                aria-label="Linterna"
                                className={`transition-colors duration-150 ${flashOn ? "text-amber-400" : "text-slate-300 hover:text-white"}`}
                            >
                                {flashOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setHistoryOpen(true)}
                            aria-label="Ver historial de escaneos"
                            className="text-slate-300 transition-colors duration-150 hover:text-white"
                        >
                            <History className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={onLogout}
                            aria-label="Cerrar sesión del scanner"
                            className="text-slate-300 transition-colors duration-150 hover:text-white"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    </div>
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
