-- CreateTable
CREATE TABLE "whatsapp_pending_step_inputs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "partialData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_pending_step_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pending_step_inputs_conversationId_key" ON "whatsapp_pending_step_inputs"("conversationId");

-- AddForeignKey
ALTER TABLE "whatsapp_pending_step_inputs" ADD CONSTRAINT "whatsapp_pending_step_inputs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
