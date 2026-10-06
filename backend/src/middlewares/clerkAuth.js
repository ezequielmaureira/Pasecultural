import { clerkMiddleware } from "@clerk/express";
import { logger } from "../logging/logger.js";

// clerkMiddleware con un único ajuste: un `Authorization: Bearer` con forma
// de JWT pero con segmentos que no son base64url/JSON válidos hace que
// @clerk/backend (decodeJwt, dentro de verifyToken) lance un SyntaxError
// crudo en vez de tratar la request como "sin sesión" — clerkMiddleware lo
// propaga y terminaba en 500, incluso en rutas públicas. Ante ese caso se
// reintenta UNA vez sin el header: la request sigue como anónima (las rutas
// públicas responden normal; requireAuth/requireRole devuelven 401). Un
// token bien formado se verifica exactamente igual que antes.
export function clerkAuth(options) {
    const middleware = clerkMiddleware(options);

    return (req, res, next) =>
        middleware(req, res, (err) => {
            if (!(err instanceof SyntaxError) || !req.headers.authorization) return next(err);

            logger.warn("clerkAuth: Authorization header malformado, la request sigue sin sesión", {
                method: req.method,
                path: req.originalUrl,
            });
            delete req.headers.authorization;
            return middleware(req, res, next);
        });
}
