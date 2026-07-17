// Tarjeta reutilizable para la sección "Compra segura".
export default function SecurityCard({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#0B1120] p-6 transition-colors duration-200 hover:border-violet-500/40">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-base font-semibold text-white">{title}</p>
        <p className="mt-1.5 text-sm text-slate-400">{description}</p>
      </div>
    </div>
  );
}
