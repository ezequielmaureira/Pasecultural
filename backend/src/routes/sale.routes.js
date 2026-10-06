import { Router } from "express";
import {
    cancelSale,
    listSalesOrganizer,
    listSalesBuyer,
    getSaleStatus,
    resendSaleConfirmationEmail,
    requestSaleRecoveryCode,
    resendSaleRecoveryCode,
    verifySaleRecoveryCode,
    requestPaymentRecoveryCode,
    resendPaymentRecoveryCode,
    verifyPaymentRecoveryCode,
    resendSaleEmailByToken,
    getSalePdfByToken,
    getPublicServiceFeeTiers,
} from "../controllers/sale.controller.js";
import { createMercadoPagoCheckout } from "../controllers/mercadoPagoCheckout.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { rateLimit } from "../middlewares/rateLimit.js";

const router = Router();

// Endpoints públicos "de adivinanza" (prueban conocer datos, no una sesión)
// — un límite básico por IP para que no sean un espacio infinito de
// intentos. Ver middlewares/rateLimit.js.
const recoverSearchRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });
const recoverResendCodeRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
const recoverVerifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const resendEmailRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
// "Pagué pero no recibí mis entradas" (ronda "recuperación de pagos", parte
// 2) — mismo criterio "de adivinanza" por IP que el resto de arriba para los
// pasos 1/resend. El paso de verificación es el único que además puede
// terminar consultando Mercado Pago (hasta MAX_CANDIDATE_SALES ×
// MAX_CONNECTIONS_PER_ORGANIZATION veces, ver mercadoPagoBuyerRecovery.
// service.js) — límite deliberadamente más estricto que recoverVerifyRateLimit
// por ese costo externo real.
const recoverPaymentSearchRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });
const recoverPaymentResendCodeRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
const recoverPaymentVerifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
// MP-2 — a diferencia del resto de arriba, este endpoint no es "de
// adivinanza": llama a la API de Mercado Pago por request, así que un
// límite por IP es sobre todo para no dejarlo como un vector barato de
// abuso/costo contra la cuenta de Mercado Pago del organizador (createSale
// nunca tuvo este problema porque no habla con ningún tercero externo).
const mercadoPagoCheckoutRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

// MP-2 — inicio real de una compra vía Mercado Pago (Checkout Pro + Split
// Payment 1:1), sin sesión — ver mercadoPagoCheckout.controller.js. Es el
// ÚNICO endpoint público que crea una venta: queda PENDING y sólo pasa a
// CONFIRMED cuando el backend verifica el pago contra Mercado Pago
// (webhook/reconciliación/recuperación). POST /api/sales, POST
// /:token/confirm-by-buyer y POST /:id/confirm (venta "manual" sin pago)
// fueron eliminados — ver sale.service.js#assertSaleConfirmationAuthorized.
router.post("/mercadopago/checkout", mercadoPagoCheckoutRateLimit, createMercadoPagoCheckout);

// MP-6 — público, sin sesión: reglas de comisión vigentes, para que el
// Wizard pueda mostrar una estimación antes del checkout. Ver
// sale.controller.js#getPublicServiceFeeTiers.
router.get("/service-fee-tiers", getPublicServiceFeeTiers);
router.get("/mine", requireAuth, listSalesBuyer);
router.get("/", requireRole("ORGANIZER"), listSalesOrganizer);
// Público, sin sesión: sólo status por publicRecoveryToken, para la
// recuperación por timeout del Wizard invitado (no puede usar GET
// /sales/mine sin cuenta).
router.get("/:token/status", getSaleStatus);

// Botón "Descargar PDF" de la pantalla "Compra encontrada" — mismo modelo
// de autorización que /:token/status (publicRecoveryToken en la URL, sin
// sesión). Ver sale.controller.js#getSalePdfByToken.
router.get("/:token/pdf", getSalePdfByToken);

router.post("/:id/cancel", requireAuth, cancelSale);

// Reintento administrativo del email de confirmación. requireRole acá es
// sólo el filtro grueso (excluye CUSTOMER/SCANNER de entrada); la
// verificación fina de "es DEVELOPER, o es el ORGANIZER dueño de ESTE
// evento puntual" vive en resendSaleConfirmationEmailService — mismo
// patrón que ya usa confirmSaleService con la organización.
router.post("/:id/resend-confirmation-email", requireRole("DEVELOPER", "ORGANIZER"), resendSaleConfirmationEmail);

// Pantalla pública "Recuperar mis entradas" — sin sesión. Email+DNI sólo
// localizan una compra propia (nunca uno solo, ver recoverSalesService); la
// autorización real es el código de 6 dígitos de /recover/verify. Ver
// sale.controller.js#requestSaleRecoveryCode / saleRecoveryVerification.service.js.
router.post("/recover", recoverSearchRateLimit, requestSaleRecoveryCode);
router.post("/recover/resend", recoverResendCodeRateLimit, resendSaleRecoveryCode);
router.post("/recover/verify", recoverVerifyRateLimit, verifySaleRecoveryCode);

// "Pagué pero no recibí mis entradas" — segunda opción de la misma pantalla
// pública, para Sales de Mercado Pago que quedaron PENDING (o ya CONFIRMED,
// caso idempotente). Mismo modelo sin sesión, mismo OTP de por medio — ver
// mercadoPagoBuyerRecovery.service.js. El paymentId SOLO viaja en el body de
// /recover/payment/verify (junto al código), nunca antes: no se persiste ni
// se consulta contra Mercado Pago hasta que el OTP sea correcto.
router.post("/recover/payment", recoverPaymentSearchRateLimit, requestPaymentRecoveryCode);
router.post("/recover/payment/resend", recoverPaymentResendCodeRateLimit, resendPaymentRecoveryCode);
router.post("/recover/payment/verify", recoverPaymentVerifyRateLimit, verifyPaymentRecoveryCode);

// Reenviar el correo desde la pantalla de recuperación — sin sesión,
// autorizado por publicRecoveryToken (mismo modelo que confirm-by-buyer y
// status). Ruta distinta de /:id/resend-confirmation-email (esa es la
// administrativa, autenticada, por id interno).
router.post("/:token/resend-email", resendEmailRateLimit, resendSaleEmailByToken);

export default router;
