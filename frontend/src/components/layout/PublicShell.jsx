import { Outlet, Link, NavLink } from "react-router-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Ticket, Search, ShoppingCart } from "lucide-react";
import Button from "../ui/Button.jsx";
import Footer from "./Footer.jsx";

const NAV_LINKS = [
  { label: "Explorar eventos", to: "/" },
  { label: "Categorías", to: "/" },
  { label: "¿Cómo funciona?", to: "/" },
  { label: "Para organizadores", to: "/para-organizadores" },
];

export default function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col bg-[#05070B]">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#05070B]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Ticket className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-white">
              Pase<span className="text-violet-400">Cultural</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.label}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  `relative py-1 text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? "text-violet-400 after:absolute after:-bottom-[21px] after:left-0 after:h-0.5 after:w-full after:bg-violet-500"
                      : "text-slate-300 hover:text-white"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="Buscar"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              aria-label="Carrito"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
            </button>
            <SignedOut>
              <Link to="/iniciar-sesion">
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-2 border border-white/15"
                >
                  Iniciar sesión
                </Button>
              </Link>
            </SignedOut>
            <SignedIn>
              <div className="ml-2">
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
