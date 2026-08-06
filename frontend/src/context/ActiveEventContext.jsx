import { createContext, useContext } from "react";
import { useSessionStorageState } from "../hooks/useSessionStorageState.js";

const ActiveEventContext = createContext(null);

// "Evento Activo" — toda la experiencia operativa del organizador
// (Dashboard, Entradas, Ventas, Scanners, Estado de Funciones, y cualquier
// pantalla futura) gira alrededor de este único valor. Si el organizador
// cambia el evento en cualquiera de esas pantallas, ese evento pasa a ser
// el activo para todas las demás — nadie tiene que volver a elegirlo.
//
// Independiente de OrganizerDataContext a propósito (mismo criterio que ya
// separa ToastContext/AuthContext): acá vive selección de UI, no datos.
// Persistido con sessionStorage (useSessionStorageState, sin cambios) —
// sobrevive a navegar entre pantallas, se pierde al cerrar la pestaña.
export function ActiveEventProvider({ children }) {
  const [activeEventId, setActiveEventId] = useSessionStorageState("organizer.activeEventId", null);

  return (
    <ActiveEventContext.Provider value={{ activeEventId, setActiveEventId }}>
      {children}
    </ActiveEventContext.Provider>
  );
}

export function useActiveEvent() {
  const ctx = useContext(ActiveEventContext);
  if (!ctx) {
    throw new Error("useActiveEvent debe usarse dentro de ActiveEventProvider");
  }
  return ctx;
}
