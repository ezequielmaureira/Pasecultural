import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Misma pila de "sólo el de arriba reacciona a Escape/Tab" que ya usa
// Modal.jsx (ver ese archivo) — un array de módulo separado del de Modal:
// un Drawer y un Modal abiertos a la vez son pilas independientes, cada uno
// gestiona su propio tope.
const drawerStack = [];

// Primitiva genérica de panel lateral (a diferencia de Modal.jsx, que es
// centrado) — misma mecánica de foco/Escape/restaurar foco al cerrar que
// Modal.jsx, para no reinventarla, pero deslizado desde la derecha en vez
// de superpuesto al centro. No existía ningún drawer lateral reutilizable
// en el proyecto (sólo ScanHistoryDrawer.jsx, un bottom-sheet propio del
// módulo Scanner) — éste queda como primitiva para el resto del panel.
export default function Drawer({ title, onClose, children, maxWidth = "max-w-md" }) {
    const titleId = useId();
    const instanceId = useId();
    const panelRef = useRef(null);
    const previouslyFocusedRef = useRef(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        drawerStack.push(instanceId);
        previouslyFocusedRef.current = document.activeElement;

        const panelNode = panelRef.current;
        const focusables = () => Array.from(panelNode.querySelectorAll(FOCUSABLE_SELECTOR));
        (focusables()[0] ?? panelNode)?.focus();

        function isTopmost() {
            return drawerStack[drawerStack.length - 1] === instanceId;
        }

        function handleKeyDown(event) {
            if (!isTopmost()) return;

            if (event.key === "Escape") {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== "Tab") return;

            const items = focusables();
            if (items.length === 0) {
                event.preventDefault();
                return;
            }
            const firstItem = items[0];
            const lastItem = items[items.length - 1];

            if (event.shiftKey && document.activeElement === firstItem) {
                event.preventDefault();
                lastItem.focus();
            } else if (!event.shiftKey && document.activeElement === lastItem) {
                event.preventDefault();
                firstItem.focus();
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            const index = drawerStack.indexOf(instanceId);
            if (index !== -1) drawerStack.splice(index, 1);
            previouslyFocusedRef.current?.focus?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/60" onClick={onClose} aria-hidden>
            <div
                ref={panelRef}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`flex h-full w-full ${maxWidth} flex-col overflow-y-auto border-l border-white/10 bg-[#0B1120] outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50`}
            >
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                    <h3 id={titleId} className="text-sm font-semibold text-white">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="text-slate-400 transition-colors duration-150 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 px-6 py-4">{children}</div>
            </div>
        </div>
    );
}
