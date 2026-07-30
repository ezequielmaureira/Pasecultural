import { ErrorCatalog } from "./ErrorCatalog.js";

// Vista derivada de ErrorCatalog: permite escribir ErrorCodes.NO_FUNCTIONS
// en vez de tipear el string "NO_FUNCTIONS" a mano (evita errores de tipeo,
// habilita autocompletado y "buscar referencias" en el editor). No agrega
// información propia — si un código no existe en ErrorCatalog, tampoco
// existe acá, así que nunca hay que mantener dos listas sincronizadas.
//
// El @type de abajo es lo que le da autocompletado real a este objeto
// derivado en tiempo de ejecución: le dice al servidor de TypeScript/JS del
// editor que cada clave de ErrorCatalog existe también acá con ese mismo
// nombre como valor.
/** @type {{ [K in keyof typeof ErrorCatalog]: K }} */
export const ErrorCodes = Object.freeze(
    Object.fromEntries(Object.keys(ErrorCatalog).map((code) => [code, code]))
);
