-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "RecordingTranscript" (
    "recordingId" TEXT NOT NULL,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'whisper-1',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationSec" INTEGER,
    "audioBytes" INTEGER,
    "text" TEXT,
    "preview" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RecordingTranscript_pkey" PRIMARY KEY ("recordingId")
);

-- AddForeignKey
ALTER TABLE "RecordingTranscript" ADD CONSTRAINT "RecordingTranscript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
