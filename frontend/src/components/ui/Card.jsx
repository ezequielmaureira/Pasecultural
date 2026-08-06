export default function Card({ title, children, className = "", ...props }) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-[#0B1120] p-6 ${className}`}
      {...props}
    >
      {title && (
        <h3 className="mb-4 text-sm font-semibold text-white">{title}</h3>
      )}
      {children}
    </div>
  );
}
