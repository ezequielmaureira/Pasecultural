import { Navigate, Outlet } from "react-router-dom";
import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { ROLE_HOME } from "../../lib/roles.js";

function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
      Cargando...
    </div>
  );
}

export default function RoleGuard({ allowedRoles, children }) {
  return (
    <>
      <SignedIn>
        <RoleGuardInner allowedRoles={allowedRoles}>{children}</RoleGuardInner>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function RoleGuardInner({ allowedRoles, children }) {
  const { backendUser, syncing } = useBackendUser();

  if (syncing || !backendUser) {
    return <Loading />;
  }

  const role = backendUser.role?.toLowerCase();

  if (!allowedRoles.includes(role)) {
    const home = ROLE_HOME[role] ?? "/iniciar-sesion";
    return <Navigate to={home} replace />;
  }

  return children ?? <Outlet />;
}
