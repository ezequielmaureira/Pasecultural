import Spinner from "./Spinner.jsx";

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

const SPINNER_SIZE_BY_BUTTON_SIZE = {
  sm: "xs",
  md: "sm",
  lg: "sm",
};

const SPINNER_TONE_BY_VARIANT = {
  primary: "border-white/30 border-t-white",
  secondary: "border-white/20 border-t-gray-100",
  ghost: "border-slate-500/40 border-t-slate-200",
};

// Compartido con LinkButton.jsx (mismo look para una acción que navega en
// vez de ejecutar código) — evita mantener dos copias del mapeo variant/size.
export function buttonClassNames({ variant = "primary", size = "md", className = "" } = {}) {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
}

// `loading` es el estado reutilizable para cualquier accion asincrona
// (guardar, continuar, publicar, etc.): deshabilita el boton, evita clicks
// duplicados y muestra un spinner + texto temporal en vez de dejarlo
// "presionado" sin feedback. Pensado para reemplazar los distintos
// isSubmitting/submitting sueltos que ya existian por formulario.
export default function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  loadingText,
  disabled = false,
  ...props
}) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={buttonClassNames({ variant, size, className })}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <Spinner size={SPINNER_SIZE_BY_BUTTON_SIZE[size]} toneClassName={SPINNER_TONE_BY_VARIANT[variant]} />
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
