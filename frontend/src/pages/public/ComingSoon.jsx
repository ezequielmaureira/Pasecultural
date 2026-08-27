import { Ticket } from "lucide-react";

// Modo Prelanzamiento — pantalla standalone (sin Navbar/Footer de
// PublicShell a propósito: el Navbar linkea a /recuperar-compra y
// /arrepentimiento, ambas también bloqueadas mientras dure el
// prelanzamiento — mostrarlas acá sólo llevaría a más pantallas como
// esta). Ver PreLaunchGate.jsx, que la renderiza en reemplazo completo del
// layout público, nunca dentro de él.
export default function ComingSoon() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#05070B] px-6 text-center">
      <div className="flex items-center gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
          <Ticket className="h-6 w-6" />
        </div>
        <span className="text-2xl font-bold text-white">
          Pase<span className="text-violet-400">Cultural</span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold uppercase tracking-[0.3em] text-violet-300">Próximamente</h1>
        <p className="max-w-md text-sm text-slate-400">
          Estamos preparando una nueva forma de descubrir y vivir la cultura.
        </p>
      </div>
    </div>
  );
}
