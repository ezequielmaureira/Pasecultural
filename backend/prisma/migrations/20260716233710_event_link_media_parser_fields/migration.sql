-- AlterTable
ALTER TABLE "event_links" ADD COLUMN     "embedUrl" TEXT,
ADD COLUMN     "isEmbeddable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "thumbnail" TEXT;
