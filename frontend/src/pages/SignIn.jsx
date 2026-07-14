import { SignIn } from "@clerk/clerk-react";

export default function SignInPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <SignIn signUpUrl="/registro" fallbackRedirectUrl="/bienvenida" />
    </div>
  );
}
