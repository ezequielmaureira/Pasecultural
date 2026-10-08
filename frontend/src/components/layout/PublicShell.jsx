import { useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../navbar/Navbar.jsx";
import Footer from "./Footer.jsx";

// `navbarBrandOverride` — único estado nuevo acá, PublicShell nunca lo
// calcula por sí mismo: sólo lo guarda y se lo pasa a Navbar. La ruta que
// lo necesita (hoy sólo OrganizationProfile.jsx, para un perfil PREMIUM)
// lo setea/limpia vía el contexto de <Outlet>, reutilizando datos que esa
// pantalla YA tiene cargados — nunca un segundo fetch, nunca localStorage/
// sessionStorage/eventos globales. Default `null` en cada navegación nueva
// a PublicShell (se remonta con cada cambio de layout) y cada ruta es
// responsable de limpiarlo en su propio cleanup si lo llegó a setear.
export default function PublicShell() {
  const [navbarBrandOverride, setNavbarBrandOverride] = useState(null);

  // `overflow-clip` (no `overflow-x-hidden`): recorta el fondo ambiental de
  // la Home (.smarticket-neon-page-ambient, que sangra por los bordes) sin
  // convertir este div en un contenedor de scroll vertical propio — era la
  // segunda barra de scroll de la Home. Ver styles/index.css (html/body).
  return (
    <div className="flex min-h-screen flex-col overflow-clip bg-[#090D0A] light:bg-slate-50">
      <Navbar brandOverride={navbarBrandOverride} />

      <main className="flex-1">
        <Outlet context={{ setNavbarBrandOverride }} />
      </main>

      <Footer />
    </div>
  );
}
