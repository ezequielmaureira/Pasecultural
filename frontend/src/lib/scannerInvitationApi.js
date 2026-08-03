import { apiFetch } from "./api.js";

// Público, sin sesión — la pantalla de invitación necesita mostrar "vas a
// operar como scanner de X evento, puerta Y" antes de que la persona
// inicie sesión con Clerk.
export async function getScannerInvitation(token) {
    const { invitation } = await apiFetch(`/api/scanner-invitations/${token}`);
    return invitation;
}

// Requiere sesión de Clerk ya resuelta.
export async function claimScannerInvitation(clerkToken, invitationToken) {
    const { invitation } = await apiFetch(`/api/scanner-invitations/${invitationToken}/claim`, {
        token: clerkToken,
        method: "POST",
    });
    return invitation;
}
