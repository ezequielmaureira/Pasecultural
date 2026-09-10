# Imagen de la instancia de PRUEBA en Fly.io (región gru / São Paulo) del
# backend de Smarticket/PaseCultural — en paralelo a Render (Oregon), que
# sigue sirviendo producción sin cambios. Ver auditoría de infraestructura
# Oregon -> São Paulo.
#
# A propósito esta imagen NUNCA ejecuta `prisma migrate deploy` ni ningún
# seed: sólo genera el cliente Prisma (`prisma generate`, necesario para que
# @prisma/client tenga el engine correcto para esta plataforma) y arranca el
# servidor con el mismo comando que ya usa Render (`npm start` ->
# node src/server.js). El schema/las migraciones de la base los sigue
# gestionando exclusivamente el flujo actual de Render/Supabase.
#
# node:22-slim (Debian, no Alpine) a propósito: el proyecto no fija una
# versión de Node en package.json ("engines" ausente); se eligió el LTS
# activo más reciente al momento de esta prueba. Debian (glibc) evita
# problemas de compatibilidad del binding nativo de `bcrypt` con musl
# (Alpine) sin tener que instalar toolchain de compilación extra.
FROM node:22-slim

WORKDIR /app

# node:22-slim no trae OpenSSL — sin esto, `prisma generate`/el motor de
# Prisma en runtime no puede detectar la versión de libssl y falla al
# conectar a la base (confirmado con un build de prueba real, no supuesto).
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Dependencias primero (mejor cacheo de capas) — build reproducible vía
# `npm ci` a partir del lockfile ya versionado en el repo.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Cliente Prisma — sólo `generate`, nunca `migrate`/`db push`/`db seed`.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
