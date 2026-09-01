import { SignedIn, SignedOut, RedirectToSignIn, useAuth } from "@clerk/clerk-react";
import { Outlet } from "react-router-dom";
import BootstrapScreen from "../shared/BootstrapScreen.jsx";

export default function RequireAuth() {
  // Mientras Clerk no resolvió `isLoaded`, `<SignedIn>`/`<SignedOut>` no
  // renderizan nada — eso dejaba ver el fondo oscuro global (#05070b)
  // "pelado" durante ese período. Mismo BootstrapScreen neutro que usa
  // AppShell mientras espera Organization: nunca se salta ni se adivina
  // autenticación, sólo se cambia QUÉ se ve mientras Clerk todavía carga.
  const { isLoaded } = useAuth();
  if (!isLoaded) return <BootstrapScreen />;

  return (
    <>
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
