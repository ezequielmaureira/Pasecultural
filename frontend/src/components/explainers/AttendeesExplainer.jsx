import { CalendarDays, CheckCircle2, Download, Heart, LayoutGrid, Lock, Mail, MapPin, Music, Ticket, Drama } from "lucide-react";
import PhoneMockup from "./PhoneMockup.jsx";
import StepCarousel from "./StepCarousel.jsx";
import { ExplainerHeader, ExplainerStep } from "./ExplainerLayout.jsx";
import {
  MockButton,
  MockChip,
  MockCover,
  MockEventCard,
  MockField,
  MockLabel,
  MockMeta,
  MockQr,
  MockRow,
  MockSearch,
  MockStepper,
  MockTicketRow,
  MockTitle,
} from "./MockUI.jsx";
import { ATTENDEE_STEPS } from "../../data/explainersData.js";

// Mismos pasos que el wizard real de compra (PurchaseWizard.jsx:
// Entradas → Resumen → Comprador, pago con Mercado Pago y confirmación con
// QR + PDF por email). Datos de ejemplo, nunca un evento real.
const PURCHASE_STEPS = ["Entradas", "Resumen", "Datos"];

const SCREENS = {
  explore: (
    <PhoneMockup>
      <MockSearch placeholder="Buscar eventos, artistas o lugares" />
      <div className="flex gap-1">
        <MockChip icon={LayoutGrid} active>Todos</MockChip>
        <MockChip icon={Music}>Música</MockChip>
        <MockChip icon={Drama}>Teatro</MockChip>
      </div>
      <MockLabel>Eventos destacados</MockLabel>
      <MockEventCard title="Concierto del Centro" date="12 de dic · 21:00" place="Teatro Municipal" />
      <MockEventCard title="Noche de Humor" date="3 de dic · 22:00" place="Centro Cultural" compact />
    </PhoneMockup>
  ),
  event: (
    <PhoneMockup back>
      <MockCover className="h-24">
        <Heart className="absolute right-2 top-2 h-3.5 w-3.5 text-white/80" />
      </MockCover>
      <div className="flex gap-1">
        <MockChip>Conferencia</MockChip>
        <MockChip>Innovación</MockChip>
      </div>
      <MockTitle>Foro Innovar 2026</MockTitle>
      <div className="flex flex-col gap-1">
        <MockMeta icon={CalendarDays}>14 de noviembre · 20:30</MockMeta>
        <MockMeta icon={MapPin}>Teatro Municipal · Río Cuarto</MockMeta>
        <MockMeta icon={Ticket}>General y Preferencial</MockMeta>
      </div>
      <div className="mt-auto flex items-center justify-between">
        <div>
          <p className="text-[9px] text-slate-500">Desde</p>
          <p className="text-[13px] font-bold text-white">$12.000</p>
        </div>
        <span className="whitespace-nowrap rounded-lg bg-brand px-3 py-2 text-[11px] font-semibold text-slate-950">Comprar</span>
      </div>
    </PhoneMockup>
  ),
  tickets: (
    <PhoneMockup back>
      <MockStepper labels={PURCHASE_STEPS} active={0} />
      <MockTitle sub="Foro Innovar 2026 · 14 de nov">Elegí tus entradas</MockTitle>
      <MockTicketRow name="General" price="$12.000" note="Acceso al evento" quantity={1} />
      <MockTicketRow name="Preferencial" price="$18.000" note="Mejor ubicación" quantity={0} />
      <div className="mt-auto">
        <MockButton>Continuar</MockButton>
      </div>
    </PhoneMockup>
  ),
  checkout: (
    <PhoneMockup back>
      <MockStepper labels={PURCHASE_STEPS} active={2} />
      <MockField label="Nombre y apellido" value="Lucía Fernández" />
      <MockField label="Email" value="lucia@email.com" icon={Mail} active />
      <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-[#111713] p-2">
        <MockRow label="1 × General" value="$12.000" />
        <MockRow label="Cargo de servicio" value="$500" />
        <div className="my-0.5 border-t border-white/10" />
        <MockRow label="Total" value="$12.500" strong />
      </div>
      <div className="mt-auto flex flex-col gap-1">
        <MockButton icon={Lock}>Pagar con Mercado Pago</MockButton>
        <p className="text-center text-[9px] text-slate-500">Pago seguro</p>
      </div>
    </PhoneMockup>
  ),
  receive: (
    <PhoneMockup>
      <div className="flex flex-col items-center gap-1 text-center">
        <CheckCircle2 className="h-6 w-6 text-brand" />
        <p className="text-[13px] font-bold text-white">¡Compra confirmada!</p>
        <p className="text-[10px] text-slate-400">Te enviamos tus entradas por email.</p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#111713] p-2">
        <MockQr className="h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold leading-tight text-white">Foro Innovar</p>
          <p className="text-[10px] text-slate-400">General</p>
          <p className="text-[10px] text-slate-500">#001234</p>
        </div>
      </div>
      <MockButton icon={Download} variant="outline">Descargar PDF</MockButton>
      <div className="mt-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-slate-300">
        <Mail className="h-3 w-3 text-brand" />
        También la recibís por email
      </div>
    </PhoneMockup>
  ),
};

export default function AttendeesExplainer() {
  return (
    <section aria-labelledby="explainer-attendees-title">
      <ExplainerHeader
        eyebrow="Para asistentes"
        title={<span id="explainer-attendees-title">Comprá tu entrada en 5 pasos</span>}
        description="Rápido, seguro y desde cualquier dispositivo."
      />
      <StepCarousel label="Pasos para comprar una entrada" desktopGridClass="lg:grid-cols-3 xl:grid-cols-5">
        {ATTENDEE_STEPS.map((step, index) => (
          <ExplainerStep key={step.id} number={index + 1} title={step.title} description={step.description}>
            {SCREENS[step.id]}
          </ExplainerStep>
        ))}
      </StepCarousel>
    </section>
  );
}
