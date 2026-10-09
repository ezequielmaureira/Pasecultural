import { useState } from "react";
import { DEFAULT_TIMEOUT_MS } from "../lib/api.js";
import { createPublishRunner } from "./publishRunner.js";

// Cuánto y cada cuánto reintentar confirmar el resultado real después de un
// timeout durante una publicación: 15 intentos cada 2s = hasta 30s extra de
// margen, sobre una operación que en el peor caso ya optimizado tarda unos
// 7-8s. No es un timeout más largo para el fetch original — es una segunda
// verificación, después, de qué pasó realmente.
const POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2000;

// Estado y lógica compartida de "publicar algo que puede tardar": un
// spinner mientras se espera la respuesta y, si la operación se cae por
// timeout, una segunda etapa que confirma el resultado real antes de
// asumir que falló. La usan tanto el wizard conversacional como el wizard
// clásico para que publicar un evento se sienta exactamente igual sin
// importar desde dónde se dispare — ni en la UI ni en cuándo se dispara
// esa segunda etapa.
//
// `run()` es lo que de verdad unifica el trigger: en vez de que cada
// llamador confíe en el timeout individual de sus propios fetches (el chat
// hace 1 request, el wizard clásico hace varios, así que la misma
// DEFAULT_TIMEOUT_MS individual nunca se sentía igual de lejos), `run()`
// trata toda la operación —sin importar cuántos requests haga `action()``
// por dentro— como una sola unidad de tiempo con un único timer. La lógica
// vive en publishRunner.js (testeable sin React).
export function usePublishFlow() {
  const [publishing, setPublishing] = useState(false);
  const [checkingOutcome, setCheckingOutcome] = useState(false);

  const { confirmAfterTimeout, run } = createPublishRunner({
    setPublishing,
    setCheckingOutcome,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollAttempts: POLL_ATTEMPTS,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  return { publishing, setPublishing, checkingOutcome, confirmAfterTimeout, run };
}
