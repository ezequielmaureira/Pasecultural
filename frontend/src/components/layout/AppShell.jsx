import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

export default function AppShell() {
  return (
    <div className="min-h-screen bg-[#05070B]">
      <Sidebar />
      <Topbar />
      <main className="pl-[var(--sidebar-width)] pt-[var(--topbar-height)]">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
