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

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

export function validateOrganizationInput({
    name,
    type,
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

    if (!email || !EMAIL_REGEX.test(email)) {
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
