// Tonos sintetizados con Web Audio (sin archivos de audio externos: nada
// que cargar, funciona igual offline). Un solo AudioContext reutilizado —
// se crea/retoma recién en el gesto del usuario que inicia el escaneo
// ("Iniciar escaneo"), porque los navegadores bloquean audio autoplay sin
// un gesto real.
let audioContext;

export function primeAudio() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!audioContext) audioContext = new Ctx();
        if (audioContext.state === "suspended") audioContext.resume();
    } catch {
        // Web Audio no disponible: se degrada a silencio en playResultSound.
    }
}

function beep(frequency, durationMs, delayMs = 0) {
    if (!audioContext) return;
    try {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.18;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        const startAt = audioContext.currentTime + delayMs / 1000;
        oscillator.start(startAt);
        oscillator.stop(startAt + durationMs / 1000);
    } catch {
        // Nunca debe romper el flujo de escaneo por un problema de audio.
    }
}

// Sonido sólo donde aporta valor real:
// - VALID: un beep agudo único y corto — la señal que el operador necesita
//   reconocer sin mirar la pantalla, entrada tras entrada.
// - ALREADY_USED / CANCELLED: doble tono grave — ambos requieren negar el
//   ingreso, así que comparten una señal de "atención" más marcada.
// - WRONG_EVENT: un tono medio único — es un error operativo (función mal
//   elegida en la app), no un intento de fraude, así que no amerita la
//   misma alarma que un rechazo real.
// - NOT_FOUND: silencio a propósito. Es, en la práctica, el resultado más
//   frecuente de un mal encuadre o un QR de otra app — sonar en cada uno,
//   con miles de personas pasando, entrena al operador a ignorar las
//   alarmas y le resta valor a la señal de VALID/rechazo real.
export function playResultSound(status) {
    if (status === "VALID") {
        beep(1046.5, 140);
    } else if (status === "ALREADY_USED" || status === "CANCELLED") {
        beep(392, 130);
        beep(392, 130, 160);
    } else if (status === "WRONG_EVENT") {
        beep(587.33, 180);
    }
}
