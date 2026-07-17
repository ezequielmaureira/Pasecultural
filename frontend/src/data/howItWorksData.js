import {
  CalendarSearch,
  CreditCard,
  QrCode,
  ScanLine,
  Ban,
  ShieldCheck,
  Ticket,
  ShieldAlert,
} from "lucide-react";

// Datos de la landing pública "¿Cómo funciona?" (frontend/src/pages/HowItWorks.jsx).
// Centralizados acá para no hardcodear textos/íconos dentro de los
// componentes reutilizables (StepCard, FaqAccordion, SecurityCard).

export const HOW_IT_WORKS_STEPS = [
  {
    step: 1,
    icon: CalendarSearch,
    title: "Elegí un evento",
    description:
      "Explorá los eventos publicados por nuestros organizadores y encontrá el que más te guste.",
  },
  {
    step: 2,
    icon: CreditCard,
    title: "Comprá online",
    description:
      "Pagás con Mercado Pago: tarjeta de crédito, tarjeta de débito, transferencia o dinero disponible en tu cuenta.",
  },
  {
    step: 3,
    icon: QrCode,
    title: "Recibí tu QR",
    description:
      "En cuanto se acredita el pago te llega por correo, con descarga inmediata. Por WhatsApp, próximamente.",
  },
  {
    step: 4,
    icon: ScanLine,
    title: "Ingresá al evento",
    description:
      "Mostrá tu QR único en la entrada. El escaneo es instantáneo: ingreso rápido, sin filas ni papeles.",
  },
  {
    step: 5,
    icon: Ban,
    title: "Cancelaciones",
    description:
      "Si un evento se cancela o reprograma, es el organizador quien gestiona y comunica los pasos a seguir.",
  },
];

export const HOW_IT_WORKS_FAQ = [
  {
    question: "¿Cuándo recibo mi QR?",
    answer:
      "Apenas se acredita el pago de tu compra. Te llega automáticamente por correo electrónico, listo para descargar.",
  },
  {
    question: "¿Cómo recupero mi entrada?",
    answer:
      "Desde \"Recuperar compra\" podés volver a acceder a tus entradas usando el mail con el que compraste.",
  },
  {
    question: "¿Puedo comprar varias entradas?",
    answer:
      "Sí. Cada tipo de entrada define un máximo por compra, que vas a ver reflejado al momento de comprar.",
  },
  {
    question: "¿Qué pasa si se suspende un evento?",
    answer:
      "El organizador es quien gestiona la suspensión o reprogramación y se comunica directamente con quienes compraron.",
  },
  {
    question: "¿Puedo pedir devolución?",
    answer:
      "Las devoluciones dependen de cada organizador. Te recomendamos contactarlo directamente ante cualquier inconveniente.",
  },
  {
    question: "¿Necesito imprimir la entrada?",
    answer: "No. Tu QR es válido tanto impreso como mostrado desde la pantalla del celular.",
  },
  {
    question: "¿Puedo ingresar mostrando el celular?",
    answer: "Sí, es la forma más rápida. El scanner del evento lee el QR directo desde tu pantalla.",
  },
  {
    question: "¿Cómo contacto al organizador?",
    answer:
      "Los datos de contacto del organizador figuran en la página de cada evento, dentro de la sección de enlaces.",
  },
];

export const HOW_IT_WORKS_SECURITY = [
  {
    icon: ShieldCheck,
    title: "Pagos seguros",
    description: "Procesados por Mercado Pago, la plataforma de pagos más usada de la región.",
  },
  {
    icon: QrCode,
    title: "QR único",
    description: "Cada entrada tiene un código QR exclusivo, generado especialmente para vos.",
  },
  {
    icon: Ticket,
    title: "Entradas válidas",
    description: "Solo se generan entradas para eventos publicados y verificados en la plataforma.",
  },
  {
    icon: ShieldAlert,
    title: "Protección contra duplicados",
    description: "El sistema detecta y bloquea cualquier intento de reutilizar un mismo QR.",
  },
];
