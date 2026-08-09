import { useEffect } from "react";
import { Link } from "react-router-dom";

// Mismo criterio que PrivacyPolicy.jsx: página pública bajo PublicShell,
// sin librería de metadata (no existe ninguna en el proyecto), sólo
// document.title acotado a esta página.
function usePageTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-400">{children}</div>
    </section>
  );
}

export default function DataDeletion() {
  usePageTitle("Eliminación de Datos | PaseCultural");

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Eliminación de Datos — PaseCultural</h1>
      <p className="mt-2 text-sm text-slate-500">Última actualización: agosto de 2026</p>

      <p className="mt-6 text-sm leading-relaxed text-slate-400">
        Si querés que eliminemos tus datos personales de PaseCultural, podés solicitarlo siguiendo los pasos de esta
        página.
      </p>

      <Section title="Qué podés pedir que eliminemos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Los datos de tu cuenta (nombre, apellido, email).</li>
          <li>Los datos de tu organización, si sos organizador.</li>
          <li>Tu historial de contacto por WhatsApp con PaseCultural.</li>
        </ul>
      </Section>

      <Section title="Cómo solicitarlo">
        <p>
          Enviá un email a{" "}
          <a href="mailto:hola@pasecultural.com" className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
            hola@pasecultural.com
          </a>{" "}
          pidiendo la eliminación de tus datos.
        </p>
      </Section>

      <Section title="Qué información necesitamos para identificarte">
        <p>Para poder ubicar tu cuenta con seguridad, incluí en tu solicitud:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>El email con el que te registraste o compraste una entrada.</li>
          <li>Tu nombre completo.</li>
          <li>Si corresponde, el nombre del evento o la organización asociada.</li>
        </ul>
      </Section>

      <Section title="Excepciones">
        <p>
          En algunos casos puede ser necesario conservar cierta información aunque solicites su eliminación — por
          ejemplo, cuando exista una obligación legal, un registro contable, o cuando sea necesario para prevenir
          fraude sobre entradas ya emitidas. En esos casos te lo vamos a explicar puntualmente en la respuesta a tu
          solicitud.
        </p>
      </Section>

      <Section title="Tiempo de procesamiento">
        <p>
          Vamos a responder tu solicitud en un plazo razonable. Al ser un equipo chico, el tiempo exacto puede variar
          según el volumen de solicitudes — no podemos prometer un plazo fijo, pero vas a recibir una confirmación
          por email.
        </p>
      </Section>

      <Section title="Más información">
        <p>
          Podés ver el detalle de cómo tratamos tus datos en general en nuestra{" "}
          <Link to="/privacidad" className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
            Política de Privacidad
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
