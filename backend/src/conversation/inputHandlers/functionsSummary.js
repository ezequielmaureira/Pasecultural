const VALID_ACTIONS = new Set(["EDIT", "CONTINUE"]);

export function parse(rawValue) {
    if (!VALID_ACTIONS.has(rawValue)) {
        return { error: 'Elegí "Editar funciones" o "Continuar".' };
    }
    return { value: rawValue };
}
