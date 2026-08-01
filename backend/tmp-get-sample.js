import prisma from './src/config/prisma.js';

async function main() {
    const events = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
        take: 5,
        include: {
            functions: {
                select: { id: true, date: true, venue: true },
            },
            organization: {
                select: { id: true, ownerId: true },
            },
            ticketTypes: {
                select: { id: true, name: true, price: true, eventId: true },
            },
        },
    });
    console.log(JSON.stringify(events, null, 2));
    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
