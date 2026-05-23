/*
  Warnings:

  - A unique constraint covering the columns `[clientId,guildId,channelId]` on the table `AutoRecord` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE INDEX "AutoRecord_guildId_clientId_idx" ON "AutoRecord"("guildId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoRecord_clientId_guildId_channelId_key" ON "AutoRecord"("clientId", "guildId", "channelId");

-- CreateIndex
CREATE INDEX "Recording_userId_clientId_createdAt_idx" ON "Recording"("userId", "clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "User_patronId_idx" ON "User"("patronId");
