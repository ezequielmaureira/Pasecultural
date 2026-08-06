// Bloque de skeleton genérico — reemplaza los `<div className="animate-pulse
// rounded bg-white/10" />` que se repetían inline en cada pantalla con su
// propio skeleton local (StatsSkeleton/TableSkeleton).
export default function SkeletonBlock({ className = "" }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} />;
}
