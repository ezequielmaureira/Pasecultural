import { isValidEmail } from "./validateEmail.js";

const ORGANIZATION_TYPES = new Set([
    "TEATRO",
    "PRODUCTORA",
    "CENTRO_CULTURAL",
    "MUNICIPALIDAD",
    "CLUB",
    "EMPRESA",
    "INDEPENDIENTE",
    "OTRO",
]);

// Rubro de contenido (Organization.organizationCategory) — mismo enum
// Prisma que valida el resto del proyecto (ver
// organization.controller.js#VALID_ORGANIZATION_CATEGORIES). Repetido acá
// a propósito (constante primitiva, sin lógica) para no crear un import
// cruzado controller -> util; si alguna vez se agrega un octavo valor al
// enum, hay que actualizar los dos lugares.
const ORGANIZATION_CATEGORIES = new Set([
    "THEATER",
    "CINEMA",
    "MUSIC",
    "SPORTS",
    "CULTURE",
    "PRODUCER",
    "OTHER",
]);

export function validateOrganizationInput({
    name,
    type,
    organizationCategory,
    email,
    phone,
    responsibleFirstName,
    responsibleLastName,
    province,
    city,
    cuit,
    responsibleDni,
}) {
    const errors = [];

    if (!name || !name.trim()) {
        errors.push("El nombre de la organización es obligatorio");
    }

    if (!type || !ORGANIZATION_TYPES.has(type)) {
        errors.push("El tipo de organización es obligatorio");
    }

    if (organizationCategory && !ORGANIZATION_CATEGORIES.has(organizationCategory)) {
        errors.push("El rubro seleccionado no es válido");
    }

    if (!isValidEmail(email)) {
        errors.push("El email es obligatorio y debe ser válido");
    }

    if (!phone || !phone.trim()) {
        errors.push("El teléfono es obligatorio");
    }

    if (!responsibleFirstName || !responsibleFirstName.trim()) {
        errors.push("El nombre del responsable es obligatorio");
    }

    if (!responsibleLastName || !responsibleLastName.trim()) {
        errors.push("El apellido del responsable es obligatorio");
    }

    if (!province || !province.trim()) {
        errors.push("La provincia es obligatoria");
    }

    if (!city || !city.trim()) {
        errors.push("La ciudad es obligatoria");
    }

    if (!(cuit && cuit.trim()) && !(responsibleDni && responsibleDni.trim())) {
        errors.push("Debe indicar el CUIT o el DNI del responsable");
    }

    return errors;
}
