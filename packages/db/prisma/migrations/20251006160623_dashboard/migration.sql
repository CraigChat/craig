-- AlterTable
ALTER TABLE "User" ADD COLUMN     "driveOptions" JSONB,
ADD COLUMN     "tierManuallySet" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);
