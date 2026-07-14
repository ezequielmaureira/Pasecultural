import prisma from "../config/prisma.js";

const DEVELOPERS = [
    "ezequiel.maureira@gmail.com"
];

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

    if (!user) {
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
    }

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