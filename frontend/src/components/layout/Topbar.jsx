import SearchInput from "../ui/SearchInput.jsx";
import UserMenu from "./UserMenu.jsx";

export default function Topbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-10 h-[var(--topbar-height)] border-b border-white/5 bg-[#0B1120] pl-[var(--sidebar-width)]">
      <div className="flex h-full items-center justify-end gap-4 px-6">
        <div className="flex items-center gap-4">
          <SearchInput className="w-64" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
