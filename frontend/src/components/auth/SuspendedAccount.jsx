import { useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { ShieldAlert } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";

// Pantalla para un User con status SUSPENDED (Developer → Usuarios). La
// sesión Clerk sigue siendo válida, así que NO se redirige al login (sería
// un loop): se muestra esto en lugar de la superficie protegida y la única
// salida es cerrar sesión. Reactivar desde Developer devuelve el acceso.
export default function SuspendedAccount() {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.assign("/");
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400 light:bg-red-50 light:text-red-600">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white light:text-slate-900">
          Tu cuenta está suspendida
        </h1>
        <p className="mt-2 text-sm text-slate-300 light:text-slate-600">
          Tu acceso a Smarticket fue suspendido.
        </p>
        <p className="mt-1 text-sm text-slate-400 light:text-slate-500">
          Si creés que se trata de un error,{" "}
          <a
            href="mailto:hola@pasecultural.com"
            className="text-brand underline underline-offset-2 hover:text-brand-soft"
          >
            contactanos
          </a>
          .
        </p>
        <Button className="mt-6 w-full" onClick={handleSignOut} loading={signingOut} loadingText="Cerrando sesión...">
          Cerrar sesión
        </Button>
      </Card>
    </div>
  );
}
