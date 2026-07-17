import { QrCode, Mail } from "lucide-react";
import HeroSection from "../components/howItWorks/HeroSection.jsx";
import StepCard from "../components/howItWorks/StepCard.jsx";
import FaqAccordion from "../components/howItWorks/FaqAccordion.jsx";
import SecurityCard from "../components/howItWorks/SecurityCard.jsx";
import {
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_FAQ,
  HOW_IT_WORKS_SECURITY,
} from "../data/howItWorksData.js";

function StepsSection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          De la compra al ingreso, en 5 pasos
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Todo el proceso está pensado para que sea simple y rápido.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {HOW_IT_WORKS_STEPS.map(({ step, icon, title, description }) => (
          <StepCard key={step} step={step} icon={icon} title={title} description={description}>
            {step === 3 && (
              <div className="mt-1 flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-violet-500/40 bg-violet-500/5 text-violet-400">
                <QrCode className="h-12 w-12" />
              </div>
            )}
          </StepCard>
        ))}
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">Preguntas frecuentes</h2>
        <p className="mt-2 text-sm text-slate-400">
          Si tenés otra duda, la sección de contacto está al final de esta página.
        </p>
      </div>

      <FaqAccordion items={HOW_IT_WORKS_FAQ} />
    </section>
  );
}

function SecuritySection() {
  return (
    <section className="border-t border-white/5 bg-[#0B1120]">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="mx-auto mb-10 max-w-xl text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Compra segura</h2>
          <p className="mt-2 text-sm text-slate-400">
            Cuidamos cada paso de tu compra para que sea confiable de punta a punta.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS_SECURITY.map(({ icon, title, description }) => (
            <SecurityCard key={title} icon={icon} title={title} description={description} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h2 className="text-2xl font-bold text-white sm:text-3xl">¿Todavía tenés dudas?</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Escribinos y te ayudamos a resolverlas.
      </p>
      <a
        href="mailto:hola@pasecultural.com"
        className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-600 px-6 text-base font-medium text-white transition-colors duration-150 hover:bg-violet-500"
      >
        <Mail className="h-4 w-4" />
        Contactanos
      </a>
    </section>
  );
}

// Landing pública "¿Cómo funciona?": explica el flujo de compra de punta a
// punta para generar confianza en compradores. No implementa sistema de
// contacto, WhatsApp ni devoluciones: solo explica cómo funciona hoy.
export default function HowItWorks() {
  return (
    <div className="flex flex-col">
      <HeroSection
        title="¿Cómo funciona PaseCultural?"
        subtitle="Comprar una entrada nunca fue tan simple."
        ctaLabel="Explorar eventos"
        ctaTo="/eventos"
      />
      <StepsSection />
      <FaqSection />
      <SecuritySection />
      <ContactSection />
    </div>
  );
}
