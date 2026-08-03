import { SignUp } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";

export default function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/bienvenida";
  // Mismo criterio que SignIn.jsx: preservar ?redirect= al cruzar hacia
  // "Iniciar sesión" para no perder el contexto (ej. una invitación de
  // scanner) si la persona en realidad ya tenía cuenta.
  const signInUrl = searchParams.get("redirect")
    ? `/iniciar-sesion?redirect=${encodeURIComponent(redirect)}`
    : "/iniciar-sesion";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignUp signInUrl={signInUrl} forceRedirectUrl={redirect} />
    </div>
  );
}
