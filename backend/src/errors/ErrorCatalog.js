// Única fuente de verdad de todos los errores de la aplicación. Cada
// entrada define, para UN código de negocio, su status HTTP, el mensaje
// técnico que va a los logs y el mensaje que ve el usuario final.
//
// Agregar un error nuevo es agregar UNA entrada acá — no hay que tocar
// ningún otro archivo: ErrorCodes.js se deriva automáticamente de las
// claves de este objeto (ver ErrorCodes.js).
//
// El código (la clave) es el contrato estable con el frontend
// (`error.code`): una vez publicado no se renombra. El `userMessage` sí
// puede reescribirse libremente con el tiempo sin romper nada del lado
// cliente. Un mismo código debe representar siempre una única condición de
// negocio — si dos contextos son funcionalmente distintos, van con dos
// códigos distintos aunque hoy compartan texto.
export const ErrorCatalog = Object.freeze({
    INTERNAL_ERROR: {
        httpStatus: 500,
        logMessage: "Unhandled internal error.",
        userMessage: "Ocurrió un error inesperado. Intentá nuevamente en unos minutos.",
    },
});
