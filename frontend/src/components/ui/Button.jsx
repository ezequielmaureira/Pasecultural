const VARIANT_CLASSES = {
  primary: "bg-violet-600 text-white hover:bg-violet-500",
  secondary: "bg-white/10 text-gray-100 hover:bg-white/15",
  ghost: "bg-transparent text-slate-300 hover:bg-white/5",
};

const SIZE_CLASSES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
