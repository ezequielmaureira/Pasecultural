import { createContext, useContext, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { apiFetch, USER_SUSPENDED_EVENT } from "../lib/api.js";

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

  // Suspendido con la app ya abierta (el sync anterior decía ACTIVE): el
  // primer 403 USER_SUSPENDED de cualquier request marca el estado acá.
  useEffect(() => {
    if (!isSignedIn) return;
    const markSuspended = () =>
      setBackendUser((prev) => ({ ...(prev ?? {}), status: "SUSPENDED" }));
    window.addEventListener(USER_SUSPENDED_EVENT, markSuspended);
    return () => window.removeEventListener(USER_SUSPENDED_EVENT, markSuspended);
  }, [isSignedIn]);

  // Clerk sólo prueba la identidad; User.status (POST /api/auth/sync) decide
  // si puede entrar a las superficies internas — ver RequireAuth/RoleGuard.
  const isSuspended = Boolean(isSignedIn) && backendUser?.status === "SUSPENDED";

  return (
    <AuthContext.Provider value={{ backendUser, syncing, isSuspended }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useBackendUser() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useBackendUser debe usarse dentro de AuthProvider");
  return ctx;
}
