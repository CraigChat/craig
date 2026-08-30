-- CreateIndex
CREATE INDEX "AutoRecord_clientId_idx" ON "AutoRecord" USING HASH ("clientId");

-- CreateIndex
CREATE INDEX "Recording_userId_createdAt_idx" ON "Recording"("userId", "createdAt" DESC);
