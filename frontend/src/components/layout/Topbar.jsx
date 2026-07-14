import { useLocation, useNavigate } from "react-router-dom";
import SearchInput from "../ui/SearchInput.jsx";
import Avatar from "../ui/Avatar.jsx";
import { ROLES, ROLE_HOME, roleFromPath } from "../../lib/roles.js";

export default function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const role = roleFromPath(location.pathname);

  return (
    <header className="fixed inset-x-0 top-0 z-10 h-[var(--topbar-height)] border-b border-white/5 bg-[#0B1120] pl-[var(--sidebar-width)]">
      <div className="flex h-full items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Viendo como</span>
          <select
            value={role}
            onChange={(event) => navigate(ROLE_HOME[event.target.value])}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-gray-100 outline-none transition-colors duration-150 hover:bg-white/10 focus:border-violet-500"
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id} className="bg-[#0B1120]">
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          <SearchInput className="w-64" />
          <Avatar size="sm" />
        </div>
      </div>
    </header>
  );
}
