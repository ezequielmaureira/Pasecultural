-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WEB', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'DRAFT_SAVED', 'PUBLISHED', 'ABANDONED');

-- CreateTable
CREATE TABLE "conversation_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "ConversationChannel" NOT NULL,
    "channelRef" TEXT NOT NULL,
    "currentStepId" TEXT NOT NULL,
    "loopStack" JSONB NOT NULL DEFAULT '[]',
    "draftEvent" JSONB NOT NULL DEFAULT '{}',
    "history" JSONB NOT NULL DEFAULT '[]',
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_states_pkey" PRIMARY KEY ("id")
);
