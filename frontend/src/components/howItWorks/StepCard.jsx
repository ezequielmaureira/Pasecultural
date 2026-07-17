// Tarjeta reutilizable para cada paso de "¿Cómo funciona?". `children` es
// opcional y permite sumar contenido extra dentro del paso (por ejemplo, el
// QR ilustrativo del paso 3) sin crear una variante de componente aparte.
export default function StepCard({ step, icon: Icon, title, description, children }) {
  return (
    <div className="group flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#0B1120] p-6 text-center transition-colors duration-200 hover:border-violet-500/40">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-violet-400 transition-transform duration-200 group-hover:scale-105">
        <Icon className="h-6 w-6" />
        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
          {step}
        </span>
      </div>
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="text-sm text-slate-400">{description}</p>
      {children}
    </div>
  );
}
