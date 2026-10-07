import { CalendarDays, Check, ChevronRight, MapPin, Minus, Plus, Search } from "lucide-react";

// Primitivas de UI simplificadas para el interior de PhoneMockup. Copian
// la apariencia de las superficies reales de la app (cards #111713, bordes
// white/10, primario lima) a escala de mockup, con texto real y legible.
// Nunca se usan fuera de las piezas explicativas.

export function MockTitle({ children, sub }) {
  return (
    <div>
      <p className="text-[13px] font-bold leading-tight text-white">{children}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{sub}</p>}
    </div>
  );
}

export function MockLabel({ children }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{children}</p>;
}

export function MockSearch({ placeholder }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-slate-400">
      <Search className="h-3 w-3 shrink-0" />
      <span className="truncate">{placeholder}</span>
    </div>
  );
}

export function MockField({ label, value, icon: Icon, active = false }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-[10px] text-slate-400">{label}</p>}
      <div
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] text-white ${
          active ? "border-brand/60 bg-brand/5" : "border-white/10 bg-white/5"
        }`}
      >
        {Icon && <Icon className="h-3 w-3 shrink-0 text-slate-400" />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

export function MockChip({ children, icon: Icon, active = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${
        active ? "bg-brand text-slate-950" : "border border-white/10 bg-white/5 text-slate-300"
      }`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

// "Portada" sin foto: bloque oscuro con un único acento lima muy suave.
export function MockCover({ className = "h-16", children }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-white/5 bg-[radial-gradient(circle_at_30%_20%,rgba(182,255,46,0.18),transparent_60%),linear-gradient(180deg,#1a2118,#0d120e)] ${className}`}
    >
      {children}
    </div>
  );
}

// `compact`: sin portada ni lugar, para que entre una segunda card.
export function MockEventCard({ title, date, place, compact = false }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#111713]">
      {!compact && <MockCover className="h-12 rounded-none border-0" />}
      <div className="flex flex-col gap-0.5 p-2">
        <p className="truncate text-[11px] font-semibold text-white">{title}</p>
        <MockMeta icon={CalendarDays}>{date}</MockMeta>
        {!compact && <MockMeta icon={MapPin}>{place}</MockMeta>}
      </div>
    </div>
  );
}

export function MockMeta({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-1 truncate text-[10px] text-slate-400">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </p>
  );
}

export function MockTicketRow({ name, price, note, quantity }) {
  const selected = quantity > 0;
  return (
    <div className={`rounded-lg border p-2 ${selected ? "border-brand/50 bg-brand/5" : "border-white/10 bg-[#111713]"}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-white">{name}</p>
        <p className="text-[11px] font-bold text-white">{price}</p>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[10px] text-slate-400">{note}</p>
        {quantity !== undefined && (
          <span className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded border border-white/15 text-slate-400">
              <Minus className="h-2.5 w-2.5" />
            </span>
            <span className="w-2 text-center text-[11px] font-semibold text-white">{quantity}</span>
            <span
              className={`flex h-4 w-4 items-center justify-center rounded ${selected ? "bg-brand text-slate-950" : "border border-white/15 text-slate-400"}`}
            >
              <Plus className="h-2.5 w-2.5" />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

export function MockRow({ label, value, strong = false }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "text-[12px] font-bold text-white" : "text-[10px] text-slate-400"}`}>
      <span>{label}</span>
      <span className={strong ? "text-brand" : "text-slate-200"}>{value}</span>
    </div>
  );
}

export function MockButton({ children, icon: Icon, variant = "primary" }) {
  const look =
    variant === "primary"
      ? "bg-brand text-slate-950"
      : variant === "outline"
        ? "border border-brand/60 bg-brand/10 text-brand-soft"
        : "border border-white/10 bg-white/5 text-slate-200";
  return (
    <span className={`flex items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold ${look}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function MockStepper({ labels, active }) {
  return (
    <div className="flex items-center gap-1">
      {labels.map((label, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <div key={label} className="flex flex-1 items-center gap-1">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                current ? "bg-brand text-slate-950" : done ? "bg-brand/20 text-brand" : "border border-white/15 text-slate-500"
              }`}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : index + 1}
            </span>
            <span className={`truncate text-[9px] ${current ? "text-white" : "text-slate-500"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MockListItem({ title, subtitle, icon: Icon, active = false, trailing = true }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
        active ? "border-brand/50 bg-brand/5" : "border-white/10 bg-[#111713]"
      }`}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-brand" : "text-slate-400"}`} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-white">{title}</p>
        {subtitle && <p className="truncate text-[10px] text-slate-400">{subtitle}</p>}
      </div>
      {trailing && <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />}
    </div>
  );
}

// QR ilustrativo: patrón fijo dibujado con una grilla, nunca un QR real
// escaneable (no codifica nada).
const QR_PATTERN = [
  "1111111001011111111",
  "1000001010101000001",
  "1011101001001011101",
  "1011101011101011101",
  "1011101000101011101",
  "1000001010001000001",
  "1111111010101111111",
  "0000000011100000000",
  "1101011100110110101",
  "0110100011001101010",
  "1011011101110010111",
  "0000000010101101000",
  "1111111001001011011",
  "1000001011110010100",
  "1011101000101101111",
  "1011101011010010001",
  "1011101001101111011",
  "1000001010010100100",
  "1111111011011011101",
];

export function MockQr({ className = "h-20 w-20" }) {
  return (
    <div className={`grid grid-cols-[repeat(19,1fr)] grid-rows-[repeat(19,1fr)] gap-0 rounded-md bg-white p-1.5 ${className}`}>
      {QR_PATTERN.join("")
        .split("")
        .map((cell, index) => (
          <span key={index} className={cell === "1" ? "bg-slate-950" : ""} />
        ))}
    </div>
  );
}
