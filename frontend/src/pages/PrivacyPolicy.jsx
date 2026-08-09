import { useEffect } from "react";
import { Link } from "react-router-dom";

// Página pública, sin autenticación (vive bajo PublicShell en App.jsx, mismo
// criterio que HowItWorks.jsx/OrganizersLanding.jsx). No hay ninguna
// librería de metadata en el proyecto (index.html tiene un único <title>
// estático) — esto es el único punto donde se toca document.title, acotado
// a esta página, sin agregar ninguna dependencia nueva.
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

export default function PrivacyPolicy() {
  usePageTitle("Política de Privacidad | PaseCultural");

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Política de Privacidad — PaseCultural</h1>
      <p className="mt-2 text-sm text-slate-500">Última actualización: agosto de 2026</p>

      <p className="mt-6 text-sm leading-relaxed text-slate-400">
        PaseCultural es una plataforma para publicar eventos culturales, vender entradas y gestionar su ingreso. Esta
        página explica, en términos simples, qué datos podemos recopilar cuando usás la plataforma y cómo los
        tratamos.
      </p>

      <Section title="Qué datos podemos recopilar">
        <p>Según cómo uses PaseCultural, podemos recopilar:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Datos de cuenta (nombre, apellido, email) al registrarte como organizador o comprador.</li>
          <li>Datos de tu organización, si publicás eventos (nombre, contacto, ubicación).</li>
          <li>Datos de compra (comprador, DNI, entradas adquiridas) cuando comprás o recibís una entrada.</li>
          <li>Mensajes que nos envíes por los canales de contacto que ofrecemos, incluido WhatsApp.</li>
        </ul>
      </Section>

      <Section title="Para qué usamos estos datos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Crear y administrar tu cuenta, tus eventos o tus entradas.</li>
          <li>Generar y validar entradas (incluido el control de acceso por QR).</li>
          <li>Comunicarnos con vos sobre una compra, un evento o una consulta.</li>
          <li>Prevenir usos indebidos de la plataforma (por ejemplo, reventa fraudulenta de entradas).</li>
        </ul>
      </Section>

      <Section title="Cuentas de usuario y organizadores">
        <p>
          El acceso a la plataforma se gestiona a través de un proveedor externo de autenticación. No almacenamos tu
          contraseña: eso lo maneja ese proveedor. Los organizadores completan además datos de su organización para
          poder publicar eventos.
        </p>
      </Section>

      <Section title="Compradores y entradas">
        <p>
          Para comprar o recibir una entrada pedimos los datos mínimos necesarios para identificarte en el ingreso al
          evento (nombre, email y, en algunos casos, DNI). Esos datos quedan asociados a la entrada que generamos.
        </p>
      </Section>

      <Section title="WhatsApp Business / Meta">
        <p>
          Si interactuás con PaseCultural a través de WhatsApp, ese canal es operado usando la API de Meta
          (WhatsApp Business). El contenido de esos mensajes lo procesamos únicamente para responderte y, cuando
          corresponda, ayudarte a gestionar tus eventos — nunca para fines publicitarios. Meta procesa esos mensajes
          además según sus propias políticas de privacidad, independientes de esta.
        </p>
      </Section>

      <Section title="Proveedores externos que usamos para operar">
        <p>
          Para poder funcionar, PaseCultural utiliza servicios externos necesarios para la operación de la
          plataforma: por ejemplo, un proveedor de autenticación, un proveedor de envío de emails y un proveedor de
          alojamiento de imágenes. Estos servicios reciben únicamente los datos necesarios para cumplir su función
          (por ejemplo, tu email para enviarte una confirmación de compra).
        </p>
      </Section>

      <Section title="Qué no hacemos">
        <p>No vendemos tus datos a terceros.</p>
      </Section>

      <Section title="Medidas de seguridad">
        <p>
          Tomamos medidas razonables para proteger tus datos (por ejemplo, no almacenamos contraseñas propias y
          restringimos el acceso administrativo por rol). Ningún sistema es 100% infalible, así que no podemos
          garantizar una protección absoluta.
        </p>
      </Section>

      <Section title="Conservación de datos">
        <p>
          Conservamos tus datos mientras tengas una cuenta activa o mientras sea necesario para cumplir con la
          finalidad para la que los recopilamos (por ejemplo, mantener el historial de una entrada ya emitida), salvo
          que exista una obligación legal u operativa que exija conservarlos por más tiempo.
        </p>
      </Section>

      <Section title="Tus derechos">
        <p>
          Podés pedirnos acceder, corregir o eliminar tus datos personales. Para solicitar la eliminación de tus
          datos, visitá{" "}
          <Link to="/eliminacion-de-datos" className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
            esta página
          </Link>
          .
        </p>
      </Section>

      <Section title="Contacto">
        <p>
          Si tenés preguntas sobre esta política o sobre tus datos, escribinos a{" "}
          <a href="mailto:hola@pasecultural.com" className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
            hola@pasecultural.com
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
