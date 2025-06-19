-- CreateTable
CREATE TABLE "VoiceRegion" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionRtcVersion" (
    "regionId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionRtcVersion_pkey" PRIMARY KEY ("regionId")
);

-- CreateTable
CREATE TABLE "RegionVoiceVersion" (
    "regionId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionVoiceVersion_pkey" PRIMARY KEY ("regionId")
);

-- AddForeignKey
ALTER TABLE "RegionRtcVersion" ADD CONSTRAINT "RegionRtcVersion_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "VoiceRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegionVoiceVersion" ADD CONSTRAINT "RegionVoiceVersion_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "VoiceRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These regions are based on the current known voice regions in Discord.
-- They may not be exhaustive or up-to-date with the latest Discord regions.
INSERT INTO "VoiceRegion" ("id", "seenAt") VALUES
('brazil', CURRENT_TIMESTAMP),
('hongkong', CURRENT_TIMESTAMP),
('india', CURRENT_TIMESTAMP),
('japan', CURRENT_TIMESTAMP),
('rotterdam', CURRENT_TIMESTAMP),
('singapore', CURRENT_TIMESTAMP),
('southafrica', CURRENT_TIMESTAMP),
('sydney', CURRENT_TIMESTAMP),
('us-central', CURRENT_TIMESTAMP),
('us-east', CURRENT_TIMESTAMP),
('us-south', CURRENT_TIMESTAMP),
('us-west', CURRENT_TIMESTAMP);
