// `variant="glass"` — usado exclusivamente por la experiencia Fest Pass
// (QuickPass.jsx) para que este mismo Card se vea integrado sobre la imagen
// de fondo del evento (semitransparente, blur, borde con glow violeta) en
// vez del fondo sólido de siempre. Default ("solid") no cambia ni un pixel
// para ningún caller existente (PurchaseWizard, etc.).
const VARIANT_CLASSES = {
  solid: "border-white/10 bg-[#0B1120] light:border-slate-200 light:bg-white",
  glass: "border-white/15 bg-white/10 backdrop-blur-xl shadow-[0_0_40px_rgba(168,85,247,0.15)]",
};

export default function Card({ title, children, className = "", variant = "solid", ...props }) {
  return (
    <div
      className={`rounded-xl border p-6 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {title && (
        <h3 className="mb-4 text-sm font-semibold text-white light:text-slate-900">{title}</h3>
      )}
      {children}
    </div>
  );
}
