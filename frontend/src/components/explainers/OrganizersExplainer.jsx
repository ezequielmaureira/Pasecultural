import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Drama,
  ImagePlus,
  Landmark,
  MapPin,
  Music,
  Palette,
  Pencil,
  Plus,
  Rocket,
  Smile,
  Sparkles,
  Trophy,
} from "lucide-react";
import PhoneMockup from "./PhoneMockup.jsx";
import StepCarousel from "./StepCarousel.jsx";
import { ExplainerHeader, ExplainerStep } from "./ExplainerLayout.jsx";
import { MockButton, MockField, MockLabel, MockListItem, MockTitle } from "./MockUI.jsx";
import { ORGANIZER_STEPS } from "../../data/explainersData.js";

// Mismo recorrido que el creador conversacional real de eventos (Organizer
// > Crear evento, una pregunta a la vez). Las categorías son las reales de
// lib/eventCategories.js; los datos, de ejemplo.
const CATEGORIES = [
  { label: "Música", icon: Music, active: true },
  { label: "Teatro", icon: Drama },
  { label: "Humor", icon: Smile },
  { label: "Arte", icon: Palette },
  { label: "Cultura", icon: Landmark },
  { label: "Deportes", icon: Trophy },
];

function MockTextarea({ children }) {
  return <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-snug text-slate-300">{children}</div>;
}

function ReviewSection({ title, children }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#111713] px-2 py-1.5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[10px] font-semibold text-white">
          <Check className="h-3 w-3 text-brand" />
          {title}
        </p>
        <Pencil className="h-2.5 w-2.5 text-slate-500" />
      </div>
      <p className="mt-0.5 truncate pl-4 text-[10px] text-slate-400">{children}</p>
    </div>
  );
}

const SCREENS = {
  info: (
    <PhoneMockup>
      <MockTitle sub="Respondé una pregunta a la vez.">Crear evento</MockTitle>
      <span className="inline-flex w-fit items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300">
        <Sparkles className="h-3 w-3 text-brand" />
        Crear con tutorial
      </span>
      <p className="mt-1 text-[12px] font-semibold text-white">¿Cómo se llama tu evento?</p>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 rounded-lg border border-brand/60 bg-brand/5 px-2 py-1.5 text-[11px] text-white">
          Noche Indie Río Cuarto
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-slate-950">
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
      <MockLabel>Descripción (opcional)</MockLabel>
      <MockTextarea>Una noche de música indie con bandas locales y artistas invitados.</MockTextarea>
    </PhoneMockup>
  ),
  category: (
    <PhoneMockup>
      <MockTitle>Elegí la categoría</MockTitle>
      <div className="grid grid-cols-3 gap-1">
        {CATEGORIES.map(({ label, icon: Icon, active }) => (
          <div
            key={label}
            className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[9px] ${
              active ? "border-brand/60 bg-brand/10 text-white" : "border-white/10 bg-[#111713] text-slate-400"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? "text-brand" : ""}`} />
            {label}
          </div>
        ))}
      </div>
      <MockLabel>Imagen principal</MockLabel>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 bg-white/[0.03] text-center">
        <ImagePlus className="h-5 w-5 text-brand" />
        <p className="text-[10px] font-medium text-slate-300">Subí una imagen</p>
        <p className="text-[9px] text-slate-500">PNG, JPG o WEBP · máx. 5 MB</p>
      </div>
    </PhoneMockup>
  ),
  location: (
    <PhoneMockup>
      <MockTitle>¿Dónde es el evento?</MockTitle>
      <MockField value="Teatro Municipal" icon={MapPin} active />
      <MockListItem icon={MapPin} title="Teatro Municipal" subtitle="Constitución 945, Río Cuarto" active trailing={false} />
      <MockListItem icon={MapPin} title="Teatro del Bicentenario" subtitle="Belgrano 320, Río Cuarto" trailing={false} />
      <div className="relative mt-auto h-20 overflow-hidden rounded-lg border border-white/10 bg-[#0d120e] bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:18px_18px]">
        <MapPin className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 fill-brand/20 text-brand" />
      </div>
    </PhoneMockup>
  ),
  schedule: (
    <PhoneMockup>
      <MockTitle>¿Cuándo es la función?</MockTitle>
      <MockField label="Fecha" value="15/10/2026" icon={CalendarDays} active />
      <div className="grid grid-cols-2 gap-1.5">
        <MockField label="Inicio" value="21:00" icon={Clock} />
        <MockField label="Fin" value="23:30" icon={Clock} />
      </div>
      <MockLabel>Funciones</MockLabel>
      <MockListItem icon={CalendarDays} title="15/10/2026" subtitle="21:00 → 23:30" trailing={false} />
      <div className="mt-auto">
        <MockButton icon={Plus} variant="secondary">Agregar función</MockButton>
      </div>
    </PhoneMockup>
  ),
  tickets: (
    <PhoneMockup>
      <MockTitle>Entradas</MockTitle>
      <MockListItem title="General · $8.000" subtitle="200 disponibles" />
      <MockListItem title="VIP · $15.000" subtitle="50 disponibles" />
      <div className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 py-2 text-[10px] text-slate-300">
        <Plus className="h-3 w-3" />
        Agregar tipo de entrada
      </div>
      <div className="mt-auto">
        <MockButton>Continuar</MockButton>
      </div>
    </PhoneMockup>
  ),
  publish: (
    <PhoneMockup>
      <MockTitle>Revisá tu evento</MockTitle>
      <ReviewSection title="Información">Noche Indie Río Cuarto · Música</ReviewSection>
      <ReviewSection title="Ubicación">Teatro Municipal, Río Cuarto</ReviewSection>
      <ReviewSection title="Funciones">15 de octubre · 21:00 a 23:30</ReviewSection>
      <ReviewSection title="Entradas">General $8.000 · VIP $15.000</ReviewSection>
      <div className="mt-auto flex flex-col gap-1">
        <MockButton icon={Rocket}>Publicar</MockButton>
        <MockButton variant="secondary">Guardar borrador</MockButton>
      </div>
    </PhoneMockup>
  ),
};

export default function OrganizersExplainer() {
  return (
    <section aria-labelledby="explainer-organizers-title">
      <ExplainerHeader
        eyebrow="Para organizadores"
        title={<span id="explainer-organizers-title">Publicá tu evento en 6 pasos</span>}
        description="Te guiamos pregunta por pregunta, desde la web o el celular."
      />
      <StepCarousel label="Pasos para publicar un evento" desktopGridClass="lg:grid-cols-3">
        {ORGANIZER_STEPS.map((step, index) => (
          <ExplainerStep key={step.id} number={index + 1} title={step.title} description={step.description}>
            {SCREENS[step.id]}
          </ExplainerStep>
        ))}
      </StepCarousel>
    </section>
  );
}
