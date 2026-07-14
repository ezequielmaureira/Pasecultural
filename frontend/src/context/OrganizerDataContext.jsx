import { createContext, useContext, useMemo, useState } from "react";
import {
  INITIAL_EVENTS,
  INITIAL_SALES,
  INITIAL_SCANNERS,
  RECENT_SCANS,
  EVENT_STATUS,
} from "../data/organizerMockData.js";

const OrganizerDataContext = createContext(null);

export function OrganizerDataProvider({ children }) {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [sales] = useState(INITIAL_SALES);
  const [scanners, setScanners] = useState(INITIAL_SCANNERS);

  function addEvent(event) {
    const id = `ev-${Date.now()}`;
    setEvents((prev) => [...prev, { ...event, id }]);
    return id;
  }

  function updateEvent(id, patch) {
    setEvents((prev) =>
      prev.map((event) => (event.id === id ? { ...event, ...patch } : event))
    );
  }

  function removeEvent(id) {
    setEvents((prev) => prev.filter((event) => event.id !== id));
  }

  function duplicateEvent(id) {
    setEvents((prev) => {
      const source = prev.find((event) => event.id === id);
      if (!source) return prev;
      const copy = {
        ...source,
        id: `ev-${Date.now()}`,
        name: `${source.name} (copia)`,
        status: EVENT_STATUS.DRAFT,
        ticketTypes: source.ticketTypes.map((tt) => ({
          ...tt,
          id: `tt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sold: 0,
        })),
      };
      return [...prev, copy];
    });
  }

  function addScanner(scanner) {
    setScanners((prev) => [
      ...prev,
      {
        id: `sc-${Date.now()}`,
        status: "Activo",
        lastAccess: null,
        assignedEvents: [],
        ...scanner,
      },
    ]);
  }

  function updateScanner(id, patch) {
    setScanners((prev) =>
      prev.map((scanner) =>
        scanner.id === id ? { ...scanner, ...patch } : scanner
      )
    );
  }

  function removeScanner(id) {
    setScanners((prev) => prev.filter((scanner) => scanner.id !== id));
  }

  const value = useMemo(
    () => ({
      events,
      sales,
      scanners,
      recentScans: RECENT_SCANS,
      addEvent,
      updateEvent,
      removeEvent,
      duplicateEvent,
      addScanner,
      updateScanner,
      removeScanner,
    }),
    [events, sales, scanners]
  );

  return (
    <OrganizerDataContext.Provider value={value}>
      {children}
    </OrganizerDataContext.Provider>
  );
}

export function useOrganizerData() {
  const ctx = useContext(OrganizerDataContext);
  if (!ctx) {
    throw new Error(
      "useOrganizerData debe usarse dentro de OrganizerDataProvider"
    );
  }
  return ctx;
}
