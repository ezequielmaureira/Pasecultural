import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";
import { clearOrganizationThemeCache } from "../lib/organizationThemeCache.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { isSignedIn, getToken, userId } = useAuth();
  const { user, isLoaded } = useUser();
  const [backendUser, setBackendUser] = useState(null);
  const [syncing, setSyncing] = useState(true);
  // Último userId visto mientras había sesión — es lo único que permite
  // saber, en la transición a "sin sesión", DE QUIÉN era esa sesión para
  // limpiar únicamente su cache puntual (Premium Fase 2D.1.2). Nunca se usa
  // para nada más que esto.
  const lastSignedInUserIdRef = useRef(null);

  useEffect(() => {
    if (isSignedIn && userId) {
      lastSignedInUserIdRef.current = userId;
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Limpieza puntual del cache visual de branding — Premium Fase
      // 2D.1.2. Sólo la entrada del usuario que efectivamente cerró
      // sesión (`pc:org-theme:<clerkId>`), nunca localStorage.clear() ni
      // nada relacionado a Clerk.
      if (lastSignedInUserIdRef.current) {
        clearOrganizationThemeCache(lastSignedInUserIdRef.current);
        lastSignedInUserIdRef.current = null;
      }
      setBackendUser(null);
      setSyncing(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setSyncing(true);
      try {
        const token = await getToken();
        const synced = await apiFetch("/api/auth/sync", {
          method: "POST",
          token,
        });
        if (!cancelled) setBackendUser(synced);
      } catch (error) {
        console.error("No se pudo sincronizar el usuario", error);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user?.id, getToken]);

  return (
    <AuthContext.Provider value={{ backendUser, syncing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useBackendUser() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useBackendUser debe usarse dentro de AuthProvider");
  return ctx;
}
