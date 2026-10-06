import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import { Outlet } from "react-router-dom";
import { useBackendUser } from "../../context/AuthContext.jsx";
import SuspendedAccount from "./SuspendedAccount.jsx";

export default function RequireAuth() {
  return (
    <>
      <SignedIn>
        <RequireAuthInner />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

// SignedIn sólo prueba la identidad Clerk. Antes de mostrar cualquier
// superficie interna se espera el /api/auth/sync: un User SUSPENDED ve la
// pantalla dedicada (nunca un redirect al login, que con la sesión Clerk
// todavía válida haría un loop). Si el sync falla por red, se conserva el
// comportamiento anterior: el backend igual bloquea cada request.
function RequireAuthInner() {
  const { syncing, isSuspended } = useBackendUser();

  if (isSuspended) return <SuspendedAccount />;

  if (syncing) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Cargando...
      </div>
    );
  }

  return <Outlet />;
}
