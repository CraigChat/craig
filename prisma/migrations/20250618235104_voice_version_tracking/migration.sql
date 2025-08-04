-- CreateTable
CREATE TABLE "RtcVersion" (
    "version" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RtcVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "VoiceVersion" (
    "version" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceVersion_pkey" PRIMARY KEY ("version")
);
