import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { esES } from "@clerk/localizations";
import App from "./App.jsx";
import "./styles/index.css";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error("Falta VITE_CLERK_PUBLISHABLE_KEY en frontend/.env");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      localization={esES}
      signInUrl="/iniciar-sesion"
      signUpUrl="/registro"
    >
      <App />
    </ClerkProvider>
  </StrictMode>
);
