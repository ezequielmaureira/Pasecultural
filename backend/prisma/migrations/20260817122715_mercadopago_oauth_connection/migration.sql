-- CreateTable
CREATE TABLE "mercado_pago_oauth_states" (
    "id" TEXT NOT NULL,
    "stateToken" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mercado_pago_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mercado_pago_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mercadoPagoUserId" TEXT NOT NULL,
    "publicKey" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT,
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mercado_pago_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mercado_pago_oauth_states_stateToken_key" ON "mercado_pago_oauth_states"("stateToken");

-- CreateIndex
CREATE INDEX "mercado_pago_oauth_states_organizationId_idx" ON "mercado_pago_oauth_states"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mercado_pago_connections_organizationId_key" ON "mercado_pago_connections"("organizationId");

-- AddForeignKey
ALTER TABLE "mercado_pago_oauth_states" ADD CONSTRAINT "mercado_pago_oauth_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mercado_pago_oauth_states" ADD CONSTRAINT "mercado_pago_oauth_states_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mercado_pago_connections" ADD CONSTRAINT "mercado_pago_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
