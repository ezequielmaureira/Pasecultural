import { SignUp } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";

export default function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/bienvenida";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignUp signInUrl="/iniciar-sesion" forceRedirectUrl={redirect} />
    </div>
  );
}
