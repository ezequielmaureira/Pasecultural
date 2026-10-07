import { CheckCircle2, Play } from "lucide-react";
import PhoneMockup from "./PhoneMockup.jsx";
import { FeatureSplit } from "./ExplainerLayout.jsx";
import { MockQr } from "./MockUI.jsx";
import { SCANNER_INTRO } from "../../data/explainersData.js";

// Réplica simplificada de la pantalla real del scanner antes de escanear
// (pages/scanner/screens/ReadyScreen.jsx: "Función activa", contador de
// ingresos, "Iniciar escaneo") + el recuadro de lectura y un resultado
// válido. Datos de ejemplo.
function ScannerScreen() {
  return (
    <PhoneMockup screenHeight="h-[340px]">
      <div className="flex flex-col items-center gap-0.5 text-center">
        <p className="text-[9px] uppercase tracking-wide text-slate-500">Función activa</p>
        <p className="text-[13px] font-bold text-white">Noche Indie</p>
        <p className="text-[10px] text-slate-400">vie 15 oct · 21:00 hs</p>
        <p className="text-[10px] text-brand">42 ingresados / 200 · 158 restantes</p>
      </div>
      <span className="flex items-center justify-center gap-1 rounded-lg border-2 border-brand bg-brand/10 py-2 text-[10px] font-bold uppercase tracking-wide text-brand-soft">
        <Play className="h-3 w-3" />
        Iniciar escaneo
      </span>
      <div className="relative flex flex-1 items-center justify-center rounded-xl border border-white/10 bg-[#0d120e]">
        <span className="absolute left-3 top-3 h-5 w-5 rounded-tl-md border-l-2 border-t-2 border-brand" />
        <span className="absolute right-3 top-3 h-5 w-5 rounded-tr-md border-r-2 border-t-2 border-brand" />
        <span className="absolute bottom-3 left-3 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-brand" />
        <span className="absolute bottom-3 right-3 h-5 w-5 rounded-br-md border-b-2 border-r-2 border-brand" />
        <MockQr className="h-20 w-20" />
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2 py-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-white">Acceso permitido</p>
          <p className="truncate text-[10px] text-slate-400">General · Puerta A</p>
        </div>
      </div>
    </PhoneMockup>
  );
}

export default function ScannerExplainer() {
  return (
    <section aria-label="Para scanners">
      <FeatureSplit
        title={SCANNER_INTRO.title}
        description={SCANNER_INTRO.description}
        features={SCANNER_INTRO.features}
        footnote={SCANNER_INTRO.footnote}
        phone={<ScannerScreen />}
      />
    </section>
  );
}
