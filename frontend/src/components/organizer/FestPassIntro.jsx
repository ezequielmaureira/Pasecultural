import { CalendarDays, MapPin, Share2, Ticket as TicketIcon, VolumeX } from "lucide-react";
import PhoneMockup from "../explainers/PhoneMockup.jsx";
import { FeatureSplit } from "../explainers/ExplainerLayout.jsx";
import { MockCover } from "../explainers/MockUI.jsx";
import { FEST_PASS_INTRO } from "../../data/explainersData.js";

// Introducción mostrada ÚNICA Y EXCLUSIVAMENTE arriba del formulario de
// creación (FestPass.jsx, screen === "info") — nunca en tickets/preview/
// success, y nunca reemplaza ese formulario. El mockup replica en
// miniatura la pantalla REAL del comprador (pages/public/QuickPass.jsx:
// portada a pantalla completa, badge "Smarticket · Fest Pass", card con
// datos + entradas, CTA, "Ver detalle" y "Compartir"), con datos fijos de
// ejemplo — la vista previa real con los datos del organizador vive más
// adelante, en el screen "preview".
function FestPassScreen() {
  return (
    <PhoneMockup header={false} bleed screenHeight="h-[380px]">
      <MockCover className="flex h-full flex-col justify-end rounded-none border-0 p-3">
        <VolumeX className="absolute right-3 top-3 h-3.5 w-3.5 text-white/70" />
        <div className="flex flex-col gap-2">
          <p className="flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em]">
            <span className="text-white/80">Smarticket</span>
            <span className="h-1 w-1 rounded-full bg-brand" />
            <span className="text-brand">Fest Pass</span>
          </p>
          <div className="rounded-xl border border-white/15 bg-black/40 p-2.5 backdrop-blur-sm">
            <p className="text-[15px] font-extrabold leading-tight text-white">Fest</p>
            <p className="mt-1 flex items-center gap-1 text-[10px] text-white/80">
              <CalendarDays className="h-3 w-3" />
              29 de sept · 20:00
            </p>
            <p className="flex items-center gap-1 text-[10px] text-white/70">
              <MapPin className="h-3 w-3" />
              San Martín 850 · General Roca
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[11px]">
              <span className="text-white/90">VIP</span>
              <span className="font-semibold text-white">$6.000</span>
            </div>
          </div>
          <span className="flex items-center justify-center gap-1 rounded-full bg-brand py-2 text-[11px] font-bold text-slate-950">
            <TicketIcon className="h-3 w-3" />
            Comprar entradas
          </span>
          <span className="flex items-center justify-center rounded-full border border-white/25 bg-white/5 py-1.5 text-[10px] font-semibold text-white">
            Ver detalle del evento
          </span>
          <span className="flex items-center justify-center gap-1 text-[10px] text-white/70">
            <Share2 className="h-3 w-3" />
            Compartir
          </span>
        </div>
      </MockCover>
    </PhoneMockup>
  );
}

export default function FestPassIntro() {
  return (
    <FeatureSplit
      title={FEST_PASS_INTRO.title}
      description={FEST_PASS_INTRO.description}
      features={FEST_PASS_INTRO.features}
      footnote={FEST_PASS_INTRO.footnote}
      phone={<FestPassScreen />}
    />
  );
}
