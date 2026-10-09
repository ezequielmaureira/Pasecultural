import { clerkClient } from "@clerk/express";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

const DEVELOPERS = [
    "ezequiel.maureira@gmail.com"
];

function shapeUser(user) {
    return {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl,
        role: user.role,
        // /api/auth/sync NO bloquea a un suspendido (es el endpoint que
        // resuelve el estado de sesión): devuelve el status para que el
        // frontend muestre la pantalla de cuenta suspendida.
        status: user.status,
    };
}

export const syncUserService = async ({
    clerkId,
    email,
    firstName,
    lastName,
    imageUrl,
    // Ronda de preparación para producción — si Clerk confirma que el email
    // primario está verificado. Default false (seguro): sin verificación,
    // la cuenta nueva nunca adopta las compras de invitado de ese email ni
    // recibe el rol DEVELOPER por coincidencia de email — las dos cosas
    // dependen de que la persona sea realmente dueña de esa casilla.
    emailVerified = false,
}) => {
    let user = await prisma.user.findUnique({
        where: {
            clerkId,
        },
    });

    if (user) return shapeUser(user);

    // Mismo formato que guarda el checkout de invitado (getOrCreateGuestBuyer
    // en sale.service.js: trim + minúsculas) — si no, un email con
    // mayúsculas nunca encontraba sus compras previas.
    const normalizedEmail = email?.trim().toLowerCase() || "";

    const existingGuest = normalizedEmail ? await prisma.user.findUnique({ where: { email: normalizedEmail } }) : null;

    if (existingGuest && !existingGuest.clerkId) {
        if (!emailVerified) {
            logger.warn("syncUserService: email no verificado coincide con un comprador invitado — no se adopta", { clerkId });
            throw new AppError(ErrorCodes.AUTH_EMAIL_NOT_VERIFIED);
        }
        user = await prisma.user.update({
            where: { id: existingGuest.id },
            data: { clerkId, firstName, lastName, imageUrl },
        });
        return shapeUser(user);
    }

    user = await prisma.user.create({
        data: {
            clerkId,
            email: normalizedEmail,
            firstName,
            lastName,
            imageUrl,
            role: emailVerified && DEVELOPERS.includes(normalizedEmail)
                ? "DEVELOPER"
                : "CUSTOMER",
        },
    });

    return shapeUser(user);
}

export const ACCOUNT_DELETE_CONFIRMATION = "ELIMINAR";

// Autoservicio "Eliminar mi cuenta" (/perfil → Zona de peligro). Elimina la
// CUENTA (identidad/login en Clerk), nunca el historial: el User interno se
// conserva (id/email/nombre) como comprador sin cuenta — clerkId null, igual
// que un invitado — para que sus Sales/Tickets sigan existiendo y la
// recuperación pública por email+DNI+código siga funcionando. Si la persona
// vuelve a registrarse con el mismo email, syncUserService adopta esta misma
// fila (nunca un User duplicado).
//
// Orden: 1) snapshot, 2) desvincular en la base, 3) borrar la identidad en
// Clerk; si Clerk falla, se restaura el snapshot (compensación) y se
// devuelve error — nunca queda "DB dice eliminada pero Clerk sigue". Un 404
// de Clerk (identidad ya inexistente) cuenta como éxito.
//
// `deleteIdentity` es inyectable sólo para tests (nunca viene del request).
export const deleteMyAccountService = async (
    clerkId,
    { confirmation } = {},
    { deleteIdentity = (id) => clerkClient.users.deleteUser(id) } = {}
) => {
    if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
        throw new AppError(ErrorCodes.ACCOUNT_DELETE_CONFIRMATION_REQUIRED);
    }

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    if (user.role === "DEVELOPER") {
        throw new AppError(ErrorCodes.ACCOUNT_DELETE_DEVELOPER_FORBIDDEN);
    }

    // Dos decisiones explícitas: primero cerrar la organización, después la
    // cuenta. Nunca se cierra una organización desde acá.
    const activeOrganization = await prisma.organization.findFirst({
        where: { ownerId: user.id, closedAt: null },
        select: { id: true },
    });
    if (activeOrganization) {
        throw new AppError(ErrorCodes.ACCOUNT_HAS_ACTIVE_ORGANIZATION);
    }

    const snapshot = { clerkId: user.clerkId, role: user.role, imageUrl: user.imageUrl };

    await prisma.user.update({
        where: { id: user.id },
        data: { clerkId: null, imageUrl: null, role: "CUSTOMER" },
    });

    try {
        await deleteIdentity(snapshot.clerkId);
    } catch (err) {
        if (err?.status !== 404) {
            await prisma.user
                .update({ where: { id: user.id }, data: snapshot })
                .catch((restoreErr) => {
                    logger.error("deleteMyAccountService: no se pudo restaurar el User tras fallar Clerk", {
                        userId: user.id,
                        errorName: restoreErr?.name || "Error",
                    });
                });
            logger.error("deleteMyAccountService: Clerk deleteUser falló, User restaurado", {
                userId: user.id,
                status: err?.status ?? null,
                errorName: err?.name || "Error",
            });
            throw new AppError(ErrorCodes.ACCOUNT_DELETE_IDENTITY_FAILED, { cause: err });
        }
    }

    logger.info("deleteMyAccountService: cuenta eliminada", { userId: user.id });
    return { deleted: true };
};
