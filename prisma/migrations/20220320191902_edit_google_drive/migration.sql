/*
  Warnings:

  - You are about to drop the column `jwtDate` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GoogleDriveUser" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refreshToken" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "jwtDate";
