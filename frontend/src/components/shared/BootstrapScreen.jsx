import Spinner from "../ui/Spinner.jsx";

// Bootstrap screen — pantalla neutra mientras todavía no sabemos si el
// dashboard organizer corresponde a FREE (dark) o PREMIUM (Light Theme
// fijo). Se usa en dos puntos: RequireAuth (mientras Clerk resuelve
// `isLoaded`) y AppShell (mientras backendUser/organization todavía no
// están confirmados para una ruta organizer). Deliberadamente NO muestra
// logo/nombre de ninguna Organization — no hay nada que revelar todavía.
// `fixed inset-0` para cubrir el viewport completo desde el primer render
// disponible, sin depender del alto de un contenedor padre.
export default function BootstrapScreen() {
  return (
    <div className="fixed inset-0 z-50 flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F8FAFC]">
      <Spinner size="lg" toneClassName="border-[#E2E8F0] border-t-[#7C3AED]" />
      <p className="text-sm text-[#64748B]">Cargando tu espacio…</p>
    </div>
  );
}
