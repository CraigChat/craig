/*
  Warnings:

  - Added the required column `guildId` to the `AutoRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `AutoRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AutoRecord" ADD COLUMN     "guildId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL,
ALTER COLUMN "minimum" SET DEFAULT 1;
