import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useBackendUser } from "./AuthContext.jsx";
import { apiFetch } from "../lib/api.js";
import { getWhatsappEventCreationLink } from "../lib/organizerWhatsappEventLinkApi.js";

const OrganizerSessionContext = createContext(null);

// Fuente GLOBAL y LIVIANA de Organization para el botón flotante "Cargá tu
// evento con WhatsApp" (ver OrganizerWhatsAppShortcutButton.jsx) — montada
// en App.jsx por ENCIMA de la separación entre rutas públicas/AppShell/panel
// Organizer (junto a <Routes>, nunca dentro de una rama de rutas), para que
// sobreviva a la navegación Home <-> panel Organizer.
//
// Deliberadamente SEPARADA de OrganizerDataContext (events/sales/stats del
// dashboard, sólo montado dentro de "/organizador"): cargar todo eso
// globalmente sólo para sostener un botón sería absurdo. Acá sólo se pide
// `organization` (para `plan`) y, si es PREMIUM, el link de WhatsApp — nunca
// eventos/ventas/stats.
//
// role !== "organizer" (incluido "no autenticado" y "todavía no se sabe",
// mientras `syncing` es true) nunca dispara ningún fetch — ni siquiera
// mientras el rol se está resolviendo, para no pedir de más a un
// Developer/Customer/Scanner ni mostrar un estado incorrecto por un
// instante.
export function OrganizerSessionProvider({ children }) {
  const { getToken } = useAuth();
  const { backendUser, syncing } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";

  const [organization, setOrganization] = useState(null);
  const [loadingOrganization, setLoadingOrganization] = useState(false);
  const [organizationError, setOrganizationError] = useState(false);
  const [whatsappEventLink, setWhatsappEventLink] = useState(null);

  const loadOrganization = useCallback(async () => {
    setLoadingOrganization(true);
    setOrganizationError(false);
    try {
      const token = await getToken();
      const { organization: org } = await apiFetch("/api/organizations/me", { token });
      setOrganization(org);
    } catch (error) {
      console.error("No se pudo cargar la organización (atajo global de WhatsApp)", error);
      setOrganization(null);
      setOrganizationError(true);
    } finally {
      setLoadingOrganization(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (syncing) return;

    if (!isOrganizer) {
      // Logout, u otro rol autenticado: nunca dejar datos de una sesión
      // Organizer previa disponibles para el usuario/rol actual.
      setOrganization(null);
      setOrganizationError(false);
      setWhatsappEventLink(null);
      return;
    }

    loadOrganization();
    // `backendUser?.id` (no sólo `isOrganizer`) a propósito: si un Organizer
    // cierra sesión y OTRO Organizer inicia sesión en el mismo navegador,
    // esto vuelve a disparar el fetch para la organización correcta, nunca
    // reutiliza la anterior.
  }, [syncing, isOrganizer, backendUser?.id, loadOrganization]);

  // Lazy a propósito: sólo dispara cuando ya sabemos que la Organization es
  // PREMIUM, y sólo una vez (nunca se repite por cambio de ruta mientras
  // este Provider siga montado, que es siempre — vive en la raíz).
  useEffect(() => {
    if (organization?.plan !== "PREMIUM" || whatsappEventLink) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { url } = await getWhatsappEventCreationLink(token);
        if (!cancelled) setWhatsappEventLink(url);
      } catch (error) {
        console.error("No se pudo obtener el enlace de WhatsApp para carga de eventos", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organization?.plan, whatsappEventLink, getToken]);

  const value = useMemo(
    () => ({
      organization,
      loadingOrganization,
      organizationError,
      whatsappEventLink,
    }),
    [organization, loadingOrganization, organizationError, whatsappEventLink]
  );

  return <OrganizerSessionContext.Provider value={value}>{children}</OrganizerSessionContext.Provider>;
}

export function useOrganizerSession() {
  const ctx = useContext(OrganizerSessionContext);
  if (!ctx) {
    throw new Error("useOrganizerSession debe usarse dentro de OrganizerSessionProvider");
  }
  return ctx;
}
