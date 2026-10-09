// Único lugar donde vive esta lista — la separación entre `npm run
// test:unit` y `npm run test:db` (ver tests/helpers/runTests.mjs) se
// decide leyendo ESTA lista, nunca duplicada entre scripts de
// package.json. Un archivo entra acá si (y sólo si) alguno de sus tests
// usa `testWithDb`/toca Prisma real a través de tests/helpers/dbGuard.js
// — nunca por costumbre ni por parecido de nombre.
//
// Por qué una lista y no una convención de nombre de archivo (ej.
// `*.db.test.js`): habría exigido renombrar 7 archivos ya existentes
// para una ganancia marginal — esta lista ya reemplaza, uno a uno, al
// listado inline que package.json#test:db tenía antes de esta revisión.
export const DB_TEST_FILES = [
    "whatsappOrganizerDiscovery.test.js",
    "whatsappPendingStepInput.service.test.js",
    "eventServicePort.commit.perf.test.js",
    "eventCreationEngine.conversationStateCache.test.js",
    "whatsappInboundMessageClaim.service.test.js",
    "mercadoPagoConnection.service.test.js",
    "mercadoPagoCheckout.service.test.js",
    "mercadoPagoWebhook.service.test.js",
    "mercadoPagoReconciliation.service.test.js",
    "mercadoPagoBuyerRecovery.service.test.js",
    "mercadoPagoDiagnostics.service.test.js",
    "developerSales.service.test.js",
    "developerServiceFee.service.test.js",
    "serviceFeeWaiver.test.js",
    "developerAlertConfig.crud.test.js",
    "content.crud.test.js",
    "withdrawalRequest.crud.test.js",
    "withdrawalRequestReturn.crud.test.js",
    "withdrawalRequestTicketVisibility.crud.test.js",
    "organizerNotifications.crud.test.js",
    "organizationPhoneVerification.crud.test.js",
    "organizationPhoneVerificationChatbotSync.crud.test.js",
    "organizationDeveloperAlert.crud.test.js",
    "organizationPlanLimits.crud.test.js",
    "organizationSlug.crud.test.js",
    "eventPlanLimits.test.js",
    "scannerPlanLimits.test.js",
    "courtesyPlanLimits.test.js",
    "whatsappPremiumGate.test.js",
    "organizationPublicPage.test.js",
    "saleRecovery.service.test.js",
    "userSuspension.test.js",
    "salePaymentGuard.test.js",
    "ticketRefundGuard.test.js",
    "selfServiceDeletion.test.js",
    // Usan Prisma real (importan dbGuard) pero estaban fuera de esta lista:
    // bajo test:unit abortaban o se salteaban en vez de correr.
    "eventAdmissionType.test.js",
    "eventCreationEngine.admissionType.test.js",
    "eventFinishedGuard.test.js",
    "fastOrganizationPublicExperience.test.js",
    "featuredOrganizations.test.js",
    "maxTicketsPerEvent.test.js",
    "media.video.test.js",
    "organizationCategoryOwnership.test.js",
    "organizationPlan.test.js",
    "publicLaunchSettings.test.js",
    "quickPass.test.js",
    "scheduleLegacyCompat.test.js",
    "scheduleSafeSync.test.js",
    "whatsappFestPass.test.js",
    // Ronda de preparación para producción (2026-10-09).
    "checkoutGuards.test.js",
    "saleEmailRetry.test.js",
    "saleRevenue.test.js",
    "scannerFlow.test.js",
    "authSync.test.js",
];
