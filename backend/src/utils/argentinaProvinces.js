// Fase 3D — lista estática de las 24 jurisdicciones argentinas (23
// provincias + Ciudad Autónoma de Buenos Aires), única fuente de verdad
// para el selector numerado de provincia del sub-flujo de dirección manual
// de WhatsApp (whatsapp.controller.js). No existe hoy ningún enum/lista de
// provincias en el resto del proyecto (ni backend ni frontend): la Web
// completa este campo automáticamente vía Google Places, nunca lo tipea el
// organizador a mano — este archivo es exclusivo del canal WhatsApp.
export const ARGENTINA_PROVINCES = [
    "Buenos Aires",
    "Catamarca",
    "Chaco",
    "Chubut",
    "Córdoba",
    "Corrientes",
    "Entre Ríos",
    "Formosa",
    "Jujuy",
    "La Pampa",
    "La Rioja",
    "Mendoza",
    "Misiones",
    "Neuquén",
    "Río Negro",
    "Salta",
    "San Juan",
    "San Luis",
    "Santa Cruz",
    "Santa Fe",
    "Santiago del Estero",
    "Tierra del Fuego",
    "Tucumán",
    "Ciudad Autónoma de Buenos Aires",
];
