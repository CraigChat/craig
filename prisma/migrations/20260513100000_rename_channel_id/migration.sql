ALTER TABLE "Recording" RENAME COLUMN "channelId" TO "voiceChannelId";
ALTER TABLE "Recording" ADD COLUMN "messageChannelId" TEXT;
ALTER TABLE "AutoRecord" RENAME COLUMN "channelId" TO "voiceChannelId";
