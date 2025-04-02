/*
  Warnings:

  - You are about to drop the column `available` on the `Recording` table. All the data in the column will be lost.
  - Added the required column `expiresAt` to the `Recording` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Recording" DROP COLUMN "available",
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6) NOT NULL;
