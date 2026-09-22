// Developer > QA / Checklist — catálogo AUTORITATIVO de funcionalidades
// reales de Smarticket, agrupadas por rol de usuario y entidad/módulo.
//
// Esto NO es un sistema de testing automatizado: no hay pasos, resultados
// esperados, severidad ni casos de prueba. Cada entrada es una
// funcionalidad que un DEVELOPER puede probar manualmente en la
// aplicación y, si funciona, tildar. El estado (tildado o no) se persiste
// en la base (ver QaChecklistState en schema.prisma); esta lista en
// cambio vive versionada en Git, como el resto del código.
//
// Relevada leyendo el código real de main (frontend/src/App.jsx,
// frontend/src/pages/**, frontend/src/components/**,
// backend/src/routes|controllers|services/**, prisma/schema.prisma) —
// nunca inventada. Cada `key` es estable y NO debe reutilizarse para otra
// funcionalidad ni renombrarse una vez publicada (identifica el estado
// persistido en la base). Si una funcionalidad deja de existir, se borra
// su entrada acá; su fila de estado (si la tenía) queda simplemente sin
// usarse.
//
// role: "DEVELOPER" | "ORGANIZER" | "SCANNER" | "ASISTENTE" — "ASISTENTE"
// es el usuario público/comprador (no es un Role de Prisma, es un
// agrupador de UI: cubre tanto invitados como CUSTOMER autenticado).
// entity: módulo/sección dentro del rol, tal como aparece en la UI real
// (nombre del ítem de menú o de la sección de la pantalla).

function catalog(role, entity, items) {
    return items.map(([key, label]) => ({ key, role, entity, label }));
}

const RAW_CATALOG = [
    // ============================================================
    // DEVELOPER
    // ============================================================

    ...catalog("DEVELOPER", "Dashboard", [
        ["developer.dashboard.view", "Ver dashboard general"],
        ["developer.dashboard.viewMetrics", "Ver métricas generales (KPIs de la plataforma)"],
        ["developer.dashboard.viewActivity", "Ver actividad reciente"],
    ]),

    ...catalog("DEVELOPER", "Organizaciones", [
        ["developer.organizations.list", "Ver listado de organizaciones (filtrar por estado)"],
        ["developer.organizations.viewDetail", "Ver detalle de organización"],
        ["developer.organizations.approve", "Aprobar organización"],
        ["developer.organizations.reject", "Rechazar organización"],
        ["developer.organizations.suspend", "Suspender organización"],
        ["developer.organizations.reactivate", "Reactivar organización"],
        ["developer.organizations.changePlan", "Cambiar plan de organización (Free/Premium)"],
        ["developer.organizations.changeCategory", "Cambiar categoría/rubro de organización"],
        ["developer.organizations.delete", "Eliminar organización"],
    ]),

    ...catalog("DEVELOPER", "Usuarios", [
        ["developer.users.list", "Ver listado de usuarios (filtrar por rol, buscar)"],
        ["developer.users.viewDetail", "Ver detalle de usuario"],
        ["developer.users.changeRole", "Cambiar rol de usuario"],
        ["developer.users.suspend", "Suspender usuario"],
        ["developer.users.reactivate", "Reactivar usuario"],
        ["developer.users.delete", "Eliminar usuario"],
    ]),

    ...catalog("DEVELOPER", "Eventos", [
        ["developer.events.list", "Ver listado de eventos de la plataforma (filtrar por organización/estado/visibilidad)"],
    ]),

    ...catalog("DEVELOPER", "Entradas", [
        ["developer.tickets.list", "Ver listado de entradas de la plataforma (filtrar/buscar)"],
        ["developer.tickets.viewDetail", "Ver detalle de entrada (check-ins y auditoría)"],
    ]),

    ...catalog("DEVELOPER", "Scanners", [
        ["developer.scanners.list", "Ver listado de scanners de la plataforma (filtrar/buscar)"],
        ["developer.scanners.viewDetail", "Ver detalle de scanner"],
    ]),

    ...catalog("DEVELOPER", "Ventas", [
        ["developer.sales.list", "Ver listado de ventas de la plataforma (filtrar/buscar)"],
        ["developer.sales.viewDetail", "Ver detalle de venta"],
    ]),

    ...catalog("DEVELOPER", "Planes", [
        ["developer.plans.viewLimits", "Ver límites de los planes Free/Premium"],
        ["developer.plans.setMaxActiveEvents", "Configurar límite de eventos activos por plan"],
        ["developer.plans.setMaxActiveScanners", "Configurar límite de scanners activos por plan"],
        ["developer.plans.setMaxTicketsPerEvent", "Configurar límite de entradas máximas por evento"],
        ["developer.plans.togglePublicOrgPage", "Activar/desactivar página pública propia por plan"],
        ["developer.plans.toggleWhatsappCreation", "Activar/desactivar creación de eventos por WhatsApp por plan"],
    ]),

    ...catalog("DEVELOPER", "Comisión de servicio", [
        ["developer.serviceFee.viewTiers", "Ver configuración de rangos de comisión de servicio"],
        ["developer.serviceFee.editTiers", "Editar rangos de comisión de servicio"],
        ["developer.serviceFee.previewCalculation", "Previsualizar cálculo de comisión sobre un ejemplo de compra"],
    ]),

    ...catalog("DEVELOPER", "Configuración", [
        ["developer.settings.toggleLaunch", "Activar/desactivar modo prelanzamiento del sitio público"],
        ["developer.settings.editAlertConfig", "Configurar umbrales de alertas internas"],
    ]),

    ...catalog("DEVELOPER", "Contenido", [
        ["developer.content.festPassIntro", "Configurar imagen y estado de la intro de Fest Pass"],
        ["developer.content.howItWorks", "Configurar contenido de \"Cómo funciona\" (asistentes/organizadores/scanners)"],
    ]),

    ...catalog("DEVELOPER", "Base de Datos", [
        ["developer.database.viewStats", "Ver estadísticas de la base de datos"],
        ["developer.database.reset", "Reiniciar base de datos de desarrollo"],
        ["developer.database.createDemoEvent", "Crear evento demo"],
    ]),

    // ============================================================
    // ORGANIZER
    // ============================================================

    ...catalog("ORGANIZER", "Organización", [
        ["organizer.org.create", "Crear organización (onboarding)"],
        ["organizer.org.edit", "Editar datos de la organización"],
        ["organizer.org.delete", "Eliminar organización propia"],
    ]),

    ...catalog("ORGANIZER", "Dashboard", [
        ["organizer.dashboard.view", "Ver dashboard / centro de control"],
        ["organizer.dashboard.selectEventCategory", "Seleccionar categoría de evento (en curso/próximos/finalizados)"],
        ["organizer.dashboard.viewKpis", "Ver KPIs comerciales, de emisión, accesos y ocupación"],
        ["organizer.dashboard.viewActivity", "Ver actividad reciente"],
        ["organizer.dashboard.viewRecentSales", "Ver últimas ventas"],
    ]),

    ...catalog("ORGANIZER", "Eventos", [
        ["organizer.events.list", "Ver listado de eventos propios"],
        ["organizer.events.create", "Crear evento (wizard)"],
        ["organizer.events.createByChat", "Crear evento por chat conversacional"],
        ["organizer.events.edit", "Editar evento"],
        ["organizer.events.publish", "Publicar evento"],
        ["organizer.events.unpublish", "Pasar evento publicado a borrador"],
        ["organizer.events.cancel", "Cancelar evento"],
        ["organizer.events.delete", "Eliminar evento"],
        ["organizer.events.duplicate", "Duplicar evento archivado"],
        ["organizer.events.restore", "Restaurar evento archivado"],
        ["organizer.events.configureQuickPass", "Configurar Quick Pass del evento"],
        ["organizer.events.configureLinks", "Configurar enlaces del evento"],
        ["organizer.events.configureTicketCatalog", "Configurar catálogo de tipos de entrada"],
        ["organizer.events.configureSchedule", "Configurar programación/funciones del evento"],
        ["organizer.events.viewArchivedHistory", "Ver historial de eventos archivados"],
    ]),

    ...catalog("ORGANIZER", "Fest Pass", [
        ["organizer.festPass.create", "Crear evento rápido Fest Pass"],
        ["organizer.festPass.publish", "Publicar evento Fest Pass"],
        ["organizer.festPass.saveDraft", "Guardar Fest Pass como borrador"],
        ["organizer.festPass.share", "Compartir enlace de Fest Pass"],
    ]),

    ...catalog("ORGANIZER", "Tipos de entrada", [
        ["organizer.ticketTypes.viewCatalog", "Ver catálogo de tipos de entrada (con vendidas)"],
    ]),

    ...catalog("ORGANIZER", "Entradas", [
        ["organizer.tickets.list", "Ver listado de entradas por evento/función"],
        ["organizer.tickets.viewStats", "Ver estadísticas de evento/función"],
        ["organizer.tickets.bulkCancel", "Cancelar entradas seleccionadas (acción masiva)"],
        ["organizer.tickets.bulkRehabilitate", "Rehabilitar entradas seleccionadas (acción masiva)"],
        ["organizer.tickets.bulkDelete", "Eliminar entradas seleccionadas (acción masiva)"],
        ["organizer.tickets.viewDetail", "Ver detalle de entrada individual"],
        ["organizer.tickets.cancel", "Cancelar entrada individual"],
        ["organizer.tickets.markUsed", "Marcar entrada como utilizada manualmente"],
        ["organizer.tickets.rehabilitate", "Rehabilitar entrada usada"],
        ["organizer.tickets.reactivate", "Reactivar entrada cancelada"],
        ["organizer.tickets.delete", "Eliminar entrada individual"],
    ]),

    ...catalog("ORGANIZER", "Ventas", [
        ["organizer.sales.list", "Ver listado de ventas (filtrar/buscar)"],
    ]),

    ...catalog("ORGANIZER", "Cortesías", [
        ["organizer.courtesies.viewMenu", "Ver menú de cortesías"],
        ["organizer.courtesies.issue", "Emitir cortesía"],
        ["organizer.courtesies.downloadPdf", "Descargar PDF de cortesía"],
        ["organizer.courtesies.viewHistory", "Ver historial de cortesías"],
        ["organizer.courtesies.share", "Compartir/copiar enlace de cortesía"],
        ["organizer.courtesies.resendEmail", "Reenviar cortesía por correo"],
        ["organizer.courtesies.cancel", "Cancelar cortesía"],
    ]),

    ...catalog("ORGANIZER", "Scanners", [
        ["organizer.scanners.list", "Ver listado de scanners por evento"],
        ["organizer.scanners.invite", "Invitar nuevo scanner"],
        ["organizer.scanners.shareInvitation", "Compartir invitación de scanner"],
        ["organizer.scanners.edit", "Editar nombre/puerta de scanner"],
        ["organizer.scanners.disable", "Desactivar scanner"],
        ["organizer.scanners.reactivate", "Reactivar scanner"],
        ["organizer.scanners.regenerate", "Regenerar invitación de scanner"],
        ["organizer.scanners.revoke", "Revocar acceso de scanner"],
        ["organizer.scanners.delete", "Eliminar scanner"],
    ]),

    ...catalog("ORGANIZER", "Funciones", [
        ["organizer.functions.viewStatus", "Ver estado de funciones (capacidad/vendidas/ingresadas)"],
        ["organizer.functions.viewCourtesyBreakdown", "Ver desglose de cortesías por función"],
    ]),

    ...catalog("ORGANIZER", "Solicitudes de arrepentimiento", [
        ["organizer.withdrawalRequests.list", "Ver listado de solicitudes recibidas"],
        ["organizer.withdrawalRequests.changeStatus", "Cambiar estado de solicitud"],
        ["organizer.withdrawalRequests.returnTickets", "Marcar entradas de una solicitud como devueltas"],
    ]),

    ...catalog("ORGANIZER", "Configuración", [
        ["organizer.settings.verifyWhatsapp", "Verificar WhatsApp de contacto de la organización"],
        ["organizer.settings.changeWhatsapp", "Cambiar WhatsApp de contacto (con OTP)"],
        ["organizer.settings.resendPhoneOtp", "Reenviar código OTP de cambio de teléfono"],
        ["organizer.settings.resendWhatsappLink", "Reenviar enlace de confirmación por WhatsApp"],
        ["organizer.settings.cancelPhoneChange", "Cancelar cambio de teléfono en curso"],
        ["organizer.settings.deletePhone", "Eliminar WhatsApp de contacto"],
        ["organizer.settings.connectMercadoPago", "Conectar Mercado Pago"],
        ["organizer.settings.disconnectMercadoPago", "Desconectar Mercado Pago"],
        ["organizer.settings.editNotifications", "Configurar preferencias de notificaciones"],
    ]),

    ...catalog("ORGANIZER", "WhatsApp", [
        ["organizer.whatsapp.createEventShortcut", "Acceso directo \"Cargá tu evento con WhatsApp\""],
        ["organizer.whatsapp.createEventConversation", "Crear evento completo conversando por WhatsApp"],
    ]),

    // ============================================================
    // SCANNER
    // ============================================================

    ...catalog("SCANNER", "Invitación", [
        ["scanner.invitation.view", "Ver invitación de scanner"],
        ["scanner.invitation.register", "Registrarse como scanner"],
        ["scanner.invitation.verifyOtp", "Verificar código OTP de registro"],
        ["scanner.invitation.resendOtp", "Reenviar código OTP de registro"],
    ]),

    ...catalog("SCANNER", "Acceso recurrente", [
        ["scanner.portal.requestCode", "Solicitar código de acceso por email"],
        ["scanner.portal.verifyCode", "Verificar código de acceso"],
        ["scanner.portal.resendCode", "Reenviar código de acceso"],
    ]),

    ...catalog("SCANNER", "Sesión", [
        ["scanner.session.viewDashboard", "Ver dashboard del scanner"],
        ["scanner.session.switchEvent", "Cambiar evento activo"],
        ["scanner.session.logout", "Cerrar sesión de scanner"],
    ]),

    ...catalog("SCANNER", "Selección de evento", [
        ["scanner.selection.selectEvent", "Elegir evento a operar"],
        ["scanner.selection.selectFunction", "Elegir función a operar"],
        ["scanner.selection.ready", "Ver pantalla \"listo para escanear\""],
    ]),

    ...catalog("SCANNER", "Escaneo", [
        ["scanner.scan.readQr", "Escanear entrada con cámara"],
        ["scanner.scan.confirm", "Confirmar ingreso de entrada válida"],
        ["scanner.scan.cancelConfirmation", "Cancelar confirmación pendiente"],
        ["scanner.scan.resultValid", "Ver resultado: entrada válida"],
        ["scanner.scan.resultAlreadyUsed", "Ver resultado: entrada ya utilizada"],
        ["scanner.scan.resultNotFound", "Ver resultado: entrada no encontrada"],
        ["scanner.scan.resultCancelled", "Ver resultado: entrada cancelada/reintegrada"],
        ["scanner.scan.switchCamera", "Cambiar de cámara"],
        ["scanner.scan.toggleFlashlight", "Activar/desactivar linterna"],
        ["scanner.scan.offlineRetry", "Ver aviso de sin conexión con reintento"],
        ["scanner.scan.cameraError", "Ver pantalla de error de cámara"],
    ]),

    ...catalog("SCANNER", "Historial", [
        ["scanner.history.view", "Ver historial de últimos escaneos"],
    ]),

    ...catalog("SCANNER", "Estadísticas", [
        ["scanner.stats.view", "Ver estadísticas de la función"],
    ]),

    ...catalog("SCANNER", "Estados especiales", [
        ["scanner.state.empty", "Ver pantalla \"sin asignaciones activas\""],
        ["scanner.state.noSession", "Ver pantalla \"sin sesión\""],
        ["scanner.state.error", "Ver pantalla de error general"],
        ["scanner.state.reconnecting", "Ver pantalla de reconexión"],
    ]),

    // ============================================================
    // ASISTENTE (usuario público / comprador)
    // ============================================================

    ...catalog("ASISTENTE", "Home", [
        ["asistente.home.view", "Ver home"],
        ["asistente.home.filterByCategory", "Filtrar eventos por categoría desde el home"],
        ["asistente.home.recoverShortcut", "Acceso directo a \"Recuperar mis entradas\""],
        ["asistente.home.scannerShortcut", "Acceso directo a \"Soy Scanner\""],
    ]),

    ...catalog("ASISTENTE", "Eventos", [
        ["asistente.events.list", "Ver listado de eventos (filtrar/buscar/ordenar)"],
        ["asistente.events.viewDetail", "Ver detalle de evento"],
        ["asistente.events.festPassRedirect", "Redirección automática a Fest Pass"],
    ]),

    ...catalog("ASISTENTE", "Organizaciones", [
        ["asistente.organizations.list", "Ver listado de organizaciones"],
        ["asistente.organizations.viewProfile", "Ver perfil público de organización"],
    ]),

    ...catalog("ASISTENTE", "Quick Pass / Fest Pass", [
        ["asistente.festPass.view", "Ver pantalla Quick Pass / Fest Pass"],
        ["asistente.festPass.share", "Compartir Quick Pass / Fest Pass"],
        ["asistente.festPass.viewEventDetail", "Ver detalle del evento sin salir de Fest Pass"],
        ["asistente.festPass.toggleSound", "Activar/silenciar sonido del video de fondo"],
        ["asistente.festPass.purchase", "Comprar entradas dentro de Fest Pass"],
    ]),

    ...catalog("ASISTENTE", "Compra de entradas", [
        ["asistente.purchase.selectFunction", "Seleccionar función"],
        ["asistente.purchase.selectTickets", "Seleccionar tipo y cantidad de entradas"],
        ["asistente.purchase.viewSummary", "Ver resumen de compra con comisión de servicio"],
        ["asistente.purchase.buyerInfo", "Completar datos del comprador"],
        ["asistente.purchase.confirmPayment", "Confirmar compra / pagar (Mercado Pago)"],
        ["asistente.purchase.returnFromMp", "Volver de Mercado Pago y ver estado de la compra"],
        ["asistente.purchase.success", "Ver pantalla de compra exitosa con QR"],
        ["asistente.purchase.downloadPdf", "Descargar PDF de entrada"],
        ["asistente.purchase.resendEmail", "Reenviar entradas por correo (desde la compra)"],
        ["asistente.purchase.error", "Ver pantalla de error de compra"],
    ]),

    ...catalog("ASISTENTE", "Mis entradas", [
        ["asistente.myTickets.list", "Ver listado de \"Mis entradas\""],
        ["asistente.myTickets.viewDetail", "Ver detalle de entrada"],
        ["asistente.myTickets.viewQr", "Ver código QR de entrada"],
        ["asistente.myTickets.viewQrFullscreen", "Ver QR en pantalla completa"],
    ]),

    ...catalog("ASISTENTE", "Recuperación de compra", [
        ["asistente.recovery.chooseMode", "Elegir modo de recuperación"],
        ["asistente.recovery.requestOtp", "Solicitar código OTP de recuperación"],
        ["asistente.recovery.resendOtp", "Reenviar código OTP de recuperación"],
        ["asistente.recovery.verifyOtp", "Verificar código OTP de recuperación"],
        ["asistente.recovery.viewFoundPurchases", "Ver compra(s) encontrada(s)"],
        ["asistente.recovery.resendConfirmation", "Reenviar confirmación de compra (desde recuperación)"],
        ["asistente.recovery.downloadPdf", "Descargar PDF completo de la compra"],
        ["asistente.recovery.recoverPayment", "Recuperar pago no acreditado (Mercado Pago)"],
    ]),

    ...catalog("ASISTENTE", "Arrepentimiento", [
        ["asistente.withdrawal.requestOtp", "Solicitar código OTP"],
        ["asistente.withdrawal.verifyOtp", "Verificar código OTP"],
        ["asistente.withdrawal.resendOtp", "Reenviar código OTP"],
        ["asistente.withdrawal.choosePurchase", "Elegir compra a reclamar"],
        ["asistente.withdrawal.viewTickets", "Ver entradas de la compra elegida"],
        ["asistente.withdrawal.submit", "Registrar solicitud de arrepentimiento"],
        ["asistente.withdrawal.contactOrganizer", "Volver a contactar al organizador"],
        ["asistente.withdrawal.dismiss", "Descartar solicitud existente"],
    ]),

    ...catalog("ASISTENTE", "Cuenta", [
        ["asistente.account.signIn", "Iniciar sesión"],
        ["asistente.account.signUp", "Registrarse"],
        ["asistente.account.postAuthRedirect", "Redirección post-login según rol"],
    ]),

    ...catalog("ASISTENTE", "Informativas", [
        ["asistente.info.organizersLanding", "Ver landing \"Para organizadores\""],
        ["asistente.info.howItWorks", "Ver \"¿Cómo funciona?\""],
        ["asistente.info.privacy", "Ver política de privacidad"],
        ["asistente.info.dataDeletion", "Ver página de eliminación de datos"],
    ]),
];

// order: puramente de presentación (orden de despliegue en la UI) —
// nunca se usa para identificar una funcionalidad, sólo `key`. Se calcula
// acá a partir de la posición en RAW_CATALOG para no tener que mantener
// ~200 números a mano; reordenar un bloque en este archivo reordena la UI
// sin ningún otro cambio.
export const QA_CHECKLIST_CATALOG = Object.freeze(
    RAW_CATALOG.map((item, index) => Object.freeze({ ...item, order: (index + 1) * 10 }))
);

export const QA_CHECKLIST_ROLES = Object.freeze(["DEVELOPER", "ORGANIZER", "SCANNER", "ASISTENTE"]);

const BY_KEY = new Map(QA_CHECKLIST_CATALOG.map((item) => [item.key, item]));

export function getQaChecklistItem(key) {
    return BY_KEY.get(key);
}

export function isValidQaChecklistKey(key) {
    return BY_KEY.has(key);
}
