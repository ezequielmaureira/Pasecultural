import { createContext, useContext, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { isSignedIn, getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const [backendUser, setBackendUser] = useState(null);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
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
