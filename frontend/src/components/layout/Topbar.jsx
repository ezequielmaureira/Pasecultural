import { Menu } from "lucide-react";
import SearchInput from "../ui/SearchInput.jsx";
import UserMenu from "./UserMenu.jsx";

export default function Topbar({ onOpenSidebar }) {
  return (
    <header className="fixed inset-x-0 top-0 z-10 h-[var(--topbar-height)] border-b border-white/5 bg-[#0B1120] lg:pl-[var(--sidebar-width)]">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menú"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex flex-1 items-center justify-end gap-4">
          <SearchInput className="hidden w-64 sm:block" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
