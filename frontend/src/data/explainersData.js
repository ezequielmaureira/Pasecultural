import { Zap, Link2, ImageIcon, Share2, UserCheck, ScanLine } from "lucide-react";

// Textos de las piezas explicativas (¿Cómo funciona? → asistentes /
// organizadores / scanners, y la intro de Organizer > Fest Pass).
// Reemplazan a las imágenes que antes se subían desde Developer >
// Contenido (content_cards + Cloudinary, hoy legacy sin uso): editar un
// texto es editar este archivo, sin regenerar ninguna imagen. Los
// mockups que acompañan cada paso viven en components/explainers/*.

export const ATTENDEE_STEPS = [
  {
    id: "explore",
    title: "Explorá eventos",
    description: "Descubrí eventos por categoría, fecha o ubicación.",
  },
  {
    id: "event",
    title: "Mirá el evento",
    description: "Revisá la información, ubicación, fecha y tipos de entrada.",
  },
  {
    id: "tickets",
    title: "Elegí tus entradas",
    description: "Seleccioná el tipo y la cantidad que necesitás.",
  },
  {
    id: "checkout",
    title: "Revisá tu compra",
    description: "Completá tus datos, revisá el total y pagá de forma segura con Mercado Pago.",
  },
  {
    id: "receive",
    title: "Recibí tu entrada",
    description: "Recibí tu entrada por email con QR y PDF.",
  },
];

export const ORGANIZER_STEPS = [
  {
    id: "info",
    title: "Completá la información",
    description: "Contanos el nombre de tu evento para empezar.",
  },
  {
    id: "category",
    title: "Elegí categoría e imagen",
    description: "Seleccioná la categoría que mejor lo describe y cargá una imagen atractiva.",
  },
  {
    id: "location",
    title: "Definí la ubicación",
    description: "Buscá la dirección y seleccionala de la lista.",
  },
  {
    id: "schedule",
    title: "Cargá fecha y horario",
    description: "Indicá el día y la hora. Podés agregar más de una función.",
  },
  {
    id: "tickets",
    title: "Configurá tus entradas",
    description: "Definí tipos de entrada, precios y cantidad disponible.",
  },
  {
    id: "publish",
    title: "Revisá y publicá",
    description: "Confirmá que todo esté correcto y publicá tu evento.",
  },
];

export const FEST_PASS_INTRO = {
  title: "¿Qué es Fest Pass?",
  description: "Una página rápida y visual para vender tu evento, lista para compartir.",
  footnote: "Ideal para bio, historias y difusión.",
  features: [
    { icon: Zap, title: "Creá rápido", description: "Publicá tu evento en minutos y sin complicaciones." },
    { icon: Link2, title: "Generá una URL para compartir", description: "Pegala en tu bio, historias o redes." },
    { icon: ImageIcon, title: "Imagen y video", description: "Mostrá tu evento con una portada que impacte." },
  ],
};

export const SCANNER_INTRO = {
  title: "¿Qué es Scanner?",
  description: "Una herramienta simple para invitar personas, validar entradas y controlar accesos en tiempo real.",
  footnote: "Ideal para puertas, acreditaciones y control de ingresos.",
  features: [
    { icon: Share2, title: "Invitá en segundos", description: "Compartí la invitación por enlace, WhatsApp o QR, una por cada puerta." },
    {
      icon: UserCheck,
      title: "Registro guiado en minutos",
      description: "La persona abre la invitación, completa sus datos y verifica su email para empezar.",
    },
    { icon: ScanLine, title: "Escaneá y controlá accesos", description: "Validá entradas al instante y seguí los ingresos en tiempo real." },
  ],
};
