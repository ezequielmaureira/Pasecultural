import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

// Modo dedicado para que el scanner lea el QR: fondo negro puro, el QR lo
// más grande posible con máximo contraste, sin nada que distraiga — ni
// badges de estado, ni fecha, ni lugar. No es el Modal compartido agrandado:
// es un overlay propio, sin header ni card. Se monta solo (reemplaza al
// modal chico, nunca los dos apilados), así que no compite con su trap de
// foco ni con su listener de Escape.
export default function TicketQrFullscreen({ qr, ticket, onClose }) {
    const closeButtonRef = useRef(null);

    useEffect(() => {
        closeButtonRef.current?.focus();

        let wakeLock = null;
        let cancelled = false;

        // Screen Wake Lock API: mantiene la pantalla encendida mientras se
        // muestra el QR. No soportada en todos los navegadores (ej. Safari
        // hasta hace poco, iOS todavía parcial) — si falla o no existe, el QR
        // se sigue mostrando igual, sólo no se garantiza que la pantalla no
        // se apague sola. No hay control de brillo desde la Web: no existe
        // una API estándar para eso, así que no se intenta simular con
        // filtros CSS ni nada por el estilo.
        async function requestWakeLock() {
            if (!("wakeLock" in navigator)) return;
            try {
                const lock = await navigator.wakeLock.request("screen");
                if (cancelled) {
                    lock.release().catch(() => {});
                    return;
                }
                wakeLock = lock;
            } catch {
                // Permiso denegado / no disponible en este contexto: no crítico.
            }
        }
        requestWakeLock();

        function handleVisibilityChange() {
            if (document.visibilityState === "visible" && !wakeLock) {
                requestWakeLock();
            }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange);

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        }
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            document.removeEventListener("keydown", handleKeyDown);
            wakeLock?.release().catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Código QR en pantalla completa"
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black p-6"
        >
            <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Cerrar pantalla completa"
                className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
            >
                <X className="h-5 w-5" />
            </button>

            <div
                className="flex items-center justify-center rounded-2xl bg-white p-6"
                style={{ width: "min(85vw, 70vh)", height: "min(85vw, 70vh)" }}
            >
                <QRCodeSVG
                    value={qr.qrToken}
                    size={512}
                    level="M"
                    className="h-full w-full"
                    title={`Código QR de tu entrada ${qr.ticketNumber}`}
                />
            </div>

            <div className="mt-8 flex flex-col items-center gap-1 text-center">
                <p className="text-base font-semibold text-white">{ticket.event?.title}</p>
                <p className="font-mono text-sm text-slate-400">{qr.ticketNumber}</p>
                <p className="text-sm text-slate-400">{ticket.ticketType?.name}</p>
            </div>
        </div>
    );
}
