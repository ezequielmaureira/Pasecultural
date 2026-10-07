import { Ticket } from "lucide-react";

// Logo real de Smarticket — mismo isotipo (cuadrado lima + Ticket) y
// wordmark ("Smar" + T holográfica + "icket" lima) que el Navbar y el
// Footer. Por ahora lo consumen sólo las piezas explicativas
// (components/explainers/*); Navbar/Footer conservan su markup propio.
const SIZES = {
  xs: { mark: "h-4 w-4 rounded-[5px]", icon: "h-2.5 w-2.5", text: "text-[11px]" },
  sm: { mark: "h-5 w-5 rounded-md", icon: "h-3 w-3", text: "text-xs" },
  md: { mark: "h-9 w-9 rounded-xl", icon: "h-5 w-5", text: "text-lg" },
};

export default function SmarticketLogo({ size = "sm", showWordmark = true, className = "" }) {
  const s = SIZES[size] ?? SIZES.sm;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`flex shrink-0 items-center justify-center bg-brand text-slate-950 ${s.mark}`}>
        <Ticket className={s.icon} />
      </span>
      {showWordmark && (
        <span className={`font-bold leading-none text-white ${s.text}`}>
          Smar<span className="smarticket-holo-t">T</span>
          <span className="text-brand">icket</span>
        </span>
      )}
    </span>
  );
}
