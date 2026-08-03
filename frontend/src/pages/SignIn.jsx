import { SignIn } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/bienvenida";
  // Sin ?redirect= (flujo normal) manda a la landing de organizadores, como
  // siempre. CON ?redirect= (ej. viniendo de una invitación de scanner) el
  // link "Registrate" tiene que preservarlo — si no, alguien sin cuenta
  // pierde el contexto de a qué volvió apenas se registra.
  const signUpUrl = searchParams.get("redirect")
    ? `/registro?redirect=${encodeURIComponent(redirect)}`
    : "/para-organizadores";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignIn signUpUrl={signUpUrl} forceRedirectUrl={redirect} />
    </div>
  );
}
