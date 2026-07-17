import { SignIn } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/bienvenida";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignIn signUpUrl="/para-organizadores" forceRedirectUrl={redirect} />
    </div>
  );
}
