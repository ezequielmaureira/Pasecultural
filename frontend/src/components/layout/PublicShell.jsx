import { Outlet } from "react-router-dom";
import Navbar from "../navbar/Navbar.jsx";
import Footer from "./Footer.jsx";

export default function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col bg-[#05070B]">
      <Navbar />

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
