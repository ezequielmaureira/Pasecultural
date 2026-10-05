import { useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import Card from "../components/ui/Card.jsx";
import { useBackendUser } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";
import { DangerZoneCard, TypedConfirmModal } from "../components/account/DangerZone.jsx";

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-white light:text-slate-900">{value || "—"}</dd>
    </div>
  );
}

// /perfil — protegido por RequireAuth (App.jsx). Datos básicos de sólo
// lectura + autoservicio "Eliminar mi cuenta". Eliminar la cuenta borra la
// identidad/login (Clerk), nunca las compras: siguen recuperables por
// email + DNI + código desde "Recuperar mis entradas".
export default function Profile() {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const { backendUser } = useBackendUser();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const fullName =
    [backendUser?.firstName, backendUser?.lastName].filter(Boolean).join(" ") || clerkUser?.fullName || "";
  const email = backendUser?.email || clerkUser?.primaryEmailAddress?.emailAddress || "";

  async function handleDeleteAccount(confirmation) {
    const token = await getToken();
    await apiFetch("/api/auth/me", {
      token,
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    });
    // La identidad Clerk ya no existe: se cierra la sesión local y se
    // recarga desde "/" para que el navbar no quede con un usuario fantasma.
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      window.location.assign("/");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold text-white light:text-slate-900">Tu perfil</h1>

      <Card className="mt-6">
        <dl className="flex flex-col gap-4">
          <InfoRow label="Nombre" value={fullName} />
          <InfoRow label="Email" value={email} />
        </dl>
      </Card>

      <DangerZoneCard
        actionTitle="Eliminar mi cuenta"
        description="Eliminarás tu acceso a Smarticket. Las compras y entradas ya generadas no se eliminarán."
        buttonLabel="Eliminar mi cuenta"
        onRequest={() => setConfirmingDelete(true)}
      />

      {confirmingDelete && (
        <TypedConfirmModal
          title="Eliminar mi cuenta"
          paragraphs={[
            "Esta acción elimina tu cuenta de acceso.",
            "Tus compras y entradas históricas se conservarán y podrán seguir recuperándose mediante los mecanismos públicos de Smarticket.",
          ]}
          confirmLabel="Eliminar mi cuenta"
          onConfirm={handleDeleteAccount}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
