import { SignUp } from "@clerk/clerk-react";

export default function SignUpPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignUp signInUrl="/iniciar-sesion" fallbackRedirectUrl="/bienvenida" />
    </div>
  );
}
