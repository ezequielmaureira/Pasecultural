-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('TEATRO', 'PRODUCTORA', 'CENTRO_CULTURAL', 'MUNICIPALIDAD', 'CLUB', 'EMPRESA', 'INDEPENDIENTE', 'OTRO');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "city" TEXT,
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "responsibleDni" TEXT,
ADD COLUMN     "responsibleFirstName" TEXT,
ADD COLUMN     "responsibleLastName" TEXT,
ADD COLUMN     "tiktok" TEXT,
ADD COLUMN     "type" "OrganizationType";
