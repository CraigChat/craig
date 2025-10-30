-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "s3Uploaded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "s3Url" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "balanceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pendingPayoutCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "s3Bucket" TEXT,
ADD COLUMN     "s3Container" TEXT,
ADD COLUMN     "s3Enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "s3Format" TEXT,
ADD COLUMN     "s3Region" TEXT;

-- CreateTable
CREATE TABLE "S3User" (
    "id" TEXT NOT NULL,
    "accessKeyId" TEXT NOT NULL,
    "secretAccessKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'us-east-1',

    CONSTRAINT "S3User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingParticipant" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "paymentCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecordingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordingParticipant_userId_idx" ON "RecordingParticipant"("userId");

-- CreateIndex
CREATE INDEX "RecordingParticipant_recordingId_idx" ON "RecordingParticipant"("recordingId");

-- CreateIndex
CREATE INDEX "PayoutTransaction_userId_idx" ON "PayoutTransaction"("userId");

-- CreateIndex
CREATE INDEX "PayoutTransaction_status_idx" ON "PayoutTransaction"("status");

-- AddForeignKey
ALTER TABLE "RecordingParticipant" ADD CONSTRAINT "RecordingParticipant_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingParticipant" ADD CONSTRAINT "RecordingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutTransaction" ADD CONSTRAINT "PayoutTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
