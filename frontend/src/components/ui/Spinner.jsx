const SIZE_CLASSES = {
  xs: "h-3.5 w-3.5 border-2",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-2",
  xl: "h-12 w-12 border-[3px]",
};

// Spinner de marca: mismo anillo violeta que ya se usaba suelto en los
// estados de carga del wizard/onboarding/post-auth, ahora como componente
// unico para reutilizar en botones y overlays. El color va separado del
// resto de las clases (`toneClassName`) para poder pisarlo sin pelearse
// con el orden de las utilities de Tailwind.
export default function Spinner({ size = "md", toneClassName = "border-white/10 border-t-violet-500", className = "" }) {
  return (
    <span
      role="status"
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full ${SIZE_CLASSES[size]} ${toneClassName} ${className}`}
    />
  );
}
