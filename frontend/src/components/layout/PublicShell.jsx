import { Outlet } from "react-router-dom";
import Navbar from "../navbar/Navbar.jsx";
import Footer from "./Footer.jsx";

export default function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#05070B] light:bg-slate-50">
      <Navbar />

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
