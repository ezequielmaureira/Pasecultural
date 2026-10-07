import { ArrowLeft, BatteryFull, Signal, Wifi } from "lucide-react";
import SmarticketLogo from "../brand/SmarticketLogo.jsx";

// Teléfono hecho con CSS para las piezas explicativas. Es ilustrativo:
// aria-hidden, sin datos reales ni navegación. El alto de la pantalla es
// fijo (`screenHeight`) para que todos los pasos de una misma fila queden
// alineados; el ancho lo pone el contenedor, con tope en `max-w-[260px]`
// para que el mockup acompañe al texto sin competir con él. `bleed`
// quita el padding interno para pantallas a sangre (Fest Pass).
export default function PhoneMockup({ children, back = false, header = true, bleed = false, screenHeight = "h-[300px]", className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`mx-auto w-full max-w-[260px] select-none rounded-[2rem] border border-white/10 bg-[#050806] p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)] ${className}`}
    >
      <div className="overflow-hidden rounded-[1.6rem] border border-white/5 bg-[#090D0A]">
        <div className="relative flex items-center justify-between px-4 pb-1 pt-2 text-[10px] font-semibold text-white/80">
          <span>9:41</span>
          <span className="absolute left-1/2 top-1.5 h-4 w-16 -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <Signal className="h-3 w-3" />
            <Wifi className="h-3 w-3" />
            <BatteryFull className="h-3.5 w-3.5" />
          </span>
        </div>

        {header && (
          <div className="relative flex items-center justify-center border-b border-white/5 px-3 py-2">
            {back && <ArrowLeft className="absolute left-3 h-3.5 w-3.5 text-slate-400" />}
            <SmarticketLogo size="xs" />
          </div>
        )}

        <div className={`flex flex-col overflow-hidden ${bleed ? "" : "gap-2 p-3"} ${screenHeight}`}>{children}</div>
      </div>
    </div>
  );
}
