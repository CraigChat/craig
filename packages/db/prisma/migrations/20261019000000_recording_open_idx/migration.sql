-- CreateIndex
-- CONCURRENTLY avoids locking writes on the large Recording table; it must be the only statement in this migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Recording_clientId_shardId_endedAt_idx" ON "Recording"("clientId", "shardId", "endedAt");
