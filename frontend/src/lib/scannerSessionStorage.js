// Única credencial del módulo Scanner de acá en más — sin Clerk. Un string
// plano (el JWT), separado a propósito de scannerStorage.js (que guarda
// sólo la selección de evento/función, no identidad).
const STORAGE_KEY = "pasecultural:scanner:session";

export function readScannerSessionToken() {
    try {
        return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

export function writeScannerSessionToken(token) {
    localStorage.setItem(STORAGE_KEY, token);
}

export function clearScannerSessionToken() {
    localStorage.removeItem(STORAGE_KEY);
}
