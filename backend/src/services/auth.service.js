import prisma from "../config/prisma.js";

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
    };
}

export const syncUserService = async ({
    clerkId,
    email,
    firstName,
    lastName,
    imageUrl,
}) => {
    let user = await prisma.user.findUnique({
        where: {
            clerkId,
        },
    });

    if (user) return shapeUser(user);

    // Alguien pudo haber comprado como invitado con este email antes de
    // crear una cuenta (el Wizard de compra público genera un User con
    // clerkId null — ver sale.service.js#getOrCreateGuestBuyer). email es
    // @unique, así que un create() directo acá chocaría. En vez de eso, se
    // "adopta" esa misma fila: se le asigna el clerkId real y se actualizan
    // los datos de perfil. Sus compras anteriores (Sale/Ticket.buyerId ya
    // apuntan a este User.id) quedan ligadas a la cuenta automáticamente —
    // es el primer paso de "reclamar cuenta por email" mencionado para más
    // adelante, sin necesidad de un flujo de reclamo separado.
    const existingGuest = email ? await prisma.user.findUnique({ where: { email } }) : null;

    if (existingGuest && !existingGuest.clerkId) {
        user = await prisma.user.update({
            where: { id: existingGuest.id },
            data: { clerkId, firstName, lastName, imageUrl },
        });
        return shapeUser(user);
    }

    user = await prisma.user.create({
        data: {
            clerkId,
            email,
            firstName,
            lastName,
            imageUrl,
            role: DEVELOPERS.includes(email)
                ? "DEVELOPER"
                : "CUSTOMER",
        },
    });

    return shapeUser(user);
}
