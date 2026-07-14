import prisma from "../config/prisma.js";

export const getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany();

        res.status(200).json(users);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener los usuarios",
        });
    }
};

export const getUsersCount = async (req, res) => {
    try {
        const total = await prisma.user.count();

        res.status(200).json({
            total,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener la cantidad de usuarios",
        });
    }
};