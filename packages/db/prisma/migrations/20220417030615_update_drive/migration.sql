/*
  Warnings:

  - You are about to drop the column `container` on the `GoogleDriveUser` table. All the data in the column will be lost.
  - You are about to drop the column `enabled` on the `GoogleDriveUser` table. All the data in the column will be lost.
  - You are about to drop the column `format` on the `GoogleDriveUser` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GoogleDriveUser" DROP COLUMN "container",
DROP COLUMN "enabled",
DROP COLUMN "format";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "driveContainer" TEXT,
ADD COLUMN     "driveEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "driveFormat" TEXT,
ADD COLUMN     "driveService" TEXT NOT NULL DEFAULT E'google';
