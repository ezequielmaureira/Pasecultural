import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import Button from "../ui/Button.jsx";

// Hero reutilizable de la landing "¿Cómo funciona?". Queda genérico
// (título/subtítulo/CTA por props) para poder reutilizarse en otras
// landings públicas sin duplicar el maquetado.
export default function HeroSection({ title, subtitle, ctaLabel, ctaTo }) {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-500/10 via-transparent to-transparent" />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-24 text-center">
        <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p className="max-w-xl text-base text-slate-400 sm:text-lg">{subtitle}</p>
        {ctaLabel && ctaTo && (
          <Link to={ctaTo}>
            <Button size="lg" className="flex items-center gap-2">
              {ctaLabel}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </section>
  );
}
