// Piezas de layout compartidas por las composiciones explicativas
// (AttendeesExplainer, OrganizersExplainer, ScannerExplainer y
// FestPassIntro). Superficies reales de la app: cards #111713, bordes
// white/10, acento lima único, sin glow.

export function ExplainerHeader({ eyebrow, title, description }) {
  return (
    <div className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
      {eyebrow && (
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-soft">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-4 text-2xl font-extrabold leading-tight text-white sm:text-4xl">{title}</h2>
      {description && <p className="mx-auto mt-3 max-w-xl text-base text-slate-400">{description}</p>}
    </div>
  );
}

// Card de un paso: número + título + descripción (texto real, fuera del
// mockup) y el mockup debajo, siempre a su tamaño natural.
export function ExplainerStep({ number, title, description, children }) {
  return (
    <article className="flex h-full flex-col gap-5 rounded-2xl border border-white/10 bg-[#111713] p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-base font-extrabold text-slate-950">
          {number}
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-snug text-white">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{description}</p>
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  );
}

export function FeatureItem({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-base font-semibold leading-snug text-white">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{description}</p>
      </div>
    </div>
  );
}

// Teléfono + título + lista de beneficios. Desktop: 2 columnas. Mobile:
// teléfono arriba (acotado) y beneficios a ancho completo debajo.
// `as="h2"` en páginas públicas; FestPass.jsx ya tiene su propio h1.
export function FeatureSplit({ title, description, features, footnote, phone, headingLevel = "h2" }) {
  const Heading = headingLevel;
  return (
    <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-white/10 bg-[#111713] p-5 sm:p-8 md:grid-cols-[minmax(0,240px)_1fr] lg:gap-12">
      <div className="mx-auto w-full max-w-[240px] md:max-w-none">{phone}</div>
      <div className="flex flex-col gap-5">
        <div>
          <Heading className="text-2xl font-extrabold leading-tight text-white sm:text-3xl">{title}</Heading>
          <p className="mt-2 text-base leading-relaxed text-slate-300">{description}</p>
        </div>
        <div className="flex flex-col gap-3">
          {features.map((feature) => (
            <FeatureItem key={feature.title} {...feature} />
          ))}
        </div>
        {footnote && <p className="text-sm text-slate-500">{footnote}</p>}
      </div>
    </div>
  );
}
