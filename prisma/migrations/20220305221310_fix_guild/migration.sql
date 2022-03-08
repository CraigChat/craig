/*
  Warnings:

  - The primary key for the `Guild` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `guildId` on the `Guild` table. All the data in the column will be lost.
  - Added the required column `id` to the `Guild` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Guild" DROP CONSTRAINT "Guild_pkey",
DROP COLUMN "guildId",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "Guild_pkey" PRIMARY KEY ("id");
