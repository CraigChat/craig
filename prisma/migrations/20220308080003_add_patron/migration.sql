-- AlterTable
ALTER TABLE "User" ADD COLUMN     "patronId" TEXT;

-- CreateTable
CREATE TABLE "Patreon" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "tiers" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Patreon_pkey" PRIMARY KEY ("id")
);
