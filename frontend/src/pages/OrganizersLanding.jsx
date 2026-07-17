import { Link } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { ChevronRight, CheckCircle2 } from "lucide-react";
import Button from "../components/ui/Button.jsx";
import DashboardPreview from "../components/organizers/DashboardPreview.jsx";
import { useBackendUser } from "../context/AuthContext.jsx";
import {
  ORGANIZER_FEATURES,
  ORGANIZER_STEPS,
  ORGANIZER_TRUST_FEATURES,
} from "../data/organizersLandingData.js";

function OrganizerCta({ size = "lg" }) {
  const { backendUser } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";

  return (
    <>
      <SignedOut>
        <Link to="/registro?redirect=/para-organizadores">
          <Button size={size} className="flex items-center gap-2">
            Comenzar gratis
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link to="/iniciar-sesion?redirect=/para-organizadores">
          <Button size={size} variant="secondary" className="border border-white/15">
            Ya tengo una cuenta
          </Button>
        </Link>
      </SignedOut>
      <SignedIn>
        <Link to={isOrganizer ? "/organizador" : "/organizador/nueva-organizacion"}>
          <Button size={size} className="flex items-center gap-2">
            {isOrganizer ? "Ir a mi panel" : "Cargá tu organización y empezá a crear eventos"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </SignedIn>
    </>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-5xl">
          Organizá tus eventos.
          <br />
          Nosotros nos ocupamos de{" "}
          <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
            las entradas.
          </span>
        </h1>
        <p className="max-w-md text-base text-slate-400">
          Publicá eventos, vendé entradas online, controlá accesos con QR y
          seguí tus ventas en tiempo real.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <OrganizerCta />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          Sin costos fijos. Pagás solo por venta realizada.
        </p>
      </div>

      <DashboardPreview />
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <h2 className="mb-10 text-center text-2xl font-bold text-white sm:text-3xl">
        Todo lo que necesitás para tus eventos
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ORGANIZER_FEATURES.map(({ icon: Icon, iconClass, title, description }) => (
          <div
            key={title}
            className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#0B1120] p-6"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClass}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-white">{title}</p>
              <p className="mt-1.5 text-sm text-slate-400">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <h2 className="mb-10 text-center text-2xl font-bold text-white sm:text-3xl">
        ¿Cómo funciona?
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ORGANIZER_STEPS.map(({ icon: Icon, title, description }, index) => (
          <div key={title} className="relative flex flex-col items-center gap-3 text-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
              {index + 1}
            </span>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#0B1120] text-violet-400">
              <Icon className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-slate-400">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-6">
      <div className="relative overflow-hidden rounded-2xl">
        <img
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1600&q=80"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#05070Bf2] via-[#05070Bcc] to-[#05070B66]" />
        <div className="relative flex flex-col gap-6 p-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-2xl font-bold text-white sm:text-3xl">
              ¿Listo para llevar tus eventos al{" "}
              <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                siguiente nivel
              </span>
              ?
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              Unite a PaseCultural y empezá a vender entradas hoy mismo.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <OrganizerCta />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {ORGANIZER_TRUST_FEATURES.map(({ icon: Icon, title, subtitle }) => (
          <div key={title} className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function OrganizersLanding() {
  return (
    <div className="flex flex-col">
      <Hero />
      <Features />
      <HowItWorks />
      <CtaBanner />
      <TrustBar />
    </div>
  );
}
