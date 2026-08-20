import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getActiveServiceFeeTiers, replaceServiceFeeTiers } from "./serviceFee.service.js";

// MP-6 — Developer > Configuración. Sólo lectura/escritura de la
// configuración administrativa (requireRole("DEVELOPER") en
// developerServiceFee.routes.js) — el cálculo/validación en sí vive
// exclusivamente en serviceFee.service.js, nunca duplicado acá.

function serializeTier(tier) {
    return {
        id: tier.id,
        minAmount: Number(tier.minAmount),
        maxAmount: tier.maxAmount == null ? null : Number(tier.maxAmount),
        feeAmount: Number(tier.feeAmount),
        updatedAt: tier.updatedAt,
    };
}

export async function getServiceFeeConfigService() {
    const tiers = await getActiveServiceFeeTiers();
    // Trazabilidad de "la última actualización" (requisito explícito) —
    // el más reciente de los updatedAt de las filas vigentes, nunca un
    // historial completo (no hace falta, no se pidió versionado).
    const lastUpdatedAt = tiers.reduce((latest, t) => (!latest || t.updatedAt > latest ? t.updatedAt : latest), null);
    return {
        tiers: tiers.map(serializeTier),
        lastUpdatedAt,
    };
}

// userId ya resuelto por el controller (req.dbUser.id, poblado por
// requireRole) — nunca clerkId acá, este service no necesita volver a
// resolver el usuario.
export async function updateServiceFeeConfigService(userId, tiersInput) {
    if (!userId) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    await replaceServiceFeeTiers(tiersInput, userId);
    return getServiceFeeConfigService();
}
