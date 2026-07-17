import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Ticket, ShoppingCart, LayoutDashboard } from "lucide-react";
import Button from "../ui/Button.jsx";
import NavbarDropdown from "./NavbarDropdown.jsx";
import SearchBar from "./SearchBar.jsx";
import UserMenu from "./UserMenu.jsx";
import { NAVBAR_CATEGORIES } from "../../lib/eventCategories.js";
import { EXPLORE_EVENTS_OPTIONS } from "../../lib/navbarData.js";
import { useBackendUser } from "../../context/AuthContext.jsx";

const CATEGORY_ITEMS = NAVBAR_CATEGORIES.map((c) => ({
  label: c.label,
  emoji: c.emoji,
  to: `/eventos?categoria=${c.id}`,
}));

const navLinkClassName = ({ isActive }) =>
  `relative py-1 text-sm font-medium transition-colors duration-150 ${
    isActive
      ? "text-violet-400 after:absolute after:-bottom-[21px] after:left-0 after:h-0.5 after:w-full after:bg-violet-500"
      : "text-slate-300 hover:text-white"
  }`;

export default function Navbar() {
  const { backendUser } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";
  const isDeveloper = backendUser?.role?.toLowerCase() === "developer";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 8);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-20 border-b transition-all duration-300 ${
        scrolled
          ? "border-white/10 bg-[#05070B]/90 shadow-lg shadow-black/40 backdrop-blur-xl"
          : "border-white/5 bg-[#05070B]/95 backdrop-blur"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Ticket className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <span className="block text-lg font-bold text-white">
              Pase<span className="text-violet-400">Cultural</span>
            </span>
            <span className="hidden text-[11px] italic text-slate-500 sm:block">
              Descubrí, organizá y viví eventos.
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          <NavbarDropdown label="Explorar eventos" items={EXPLORE_EVENTS_OPTIONS} />
          <NavbarDropdown label="Categorías" items={CATEGORY_ITEMS} />
          <NavLink to="/como-funciona" className={navLinkClassName}>
            ¿Cómo funciona?
          </NavLink>
          <NavLink
            to={isOrganizer ? "/organizador" : "/para-organizadores"}
            className={navLinkClassName}
          >
            Para organizadores
          </NavLink>
        </nav>

        <SearchBar className="ml-2 hidden max-w-xs flex-1 md:block" />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Carrito"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white"
          >
            <ShoppingCart className="h-[18px] w-[18px]" />
          </button>
          {isDeveloper && (
            <Link to="/developer">
              <Button size="sm" className="ml-2 flex items-center gap-1.5">
                <LayoutDashboard className="h-4 w-4" />
                Panel developer
              </Button>
            </Link>
          )}
          <div className="ml-2">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
