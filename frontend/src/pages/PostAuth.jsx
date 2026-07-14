import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBackendUser } from "../context/AuthContext.jsx";
import { ROLE_HOME } from "../lib/roles.js";

export default function PostAuth() {
  const { backendUser, syncing } = useBackendUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (syncing) return;

    const roleId = backendUser?.role?.toLowerCase();
    navigate(ROLE_HOME[roleId] ?? "/usuario", { replace: true });
  }, [syncing, backendUser, navigate]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-violet-500" />
      <p className="text-sm">Preparando tu cuenta...</p>
    </div>
  );
}
