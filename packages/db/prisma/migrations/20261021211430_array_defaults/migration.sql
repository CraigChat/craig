-- AlterTable
ALTER TABLE "AutoRecord" ALTER COLUMN "triggerUsers" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "triggerRoles" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Guild" ALTER COLUMN "accessRoles" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Patreon" ALTER COLUMN "tiers" SET DEFAULT ARRAY[]::TEXT[];

-- Backfill
-- Prisma reads NULL lists as empty arrays, other clients don't
UPDATE "AutoRecord" SET "triggerUsers" = DEFAULT WHERE "triggerUsers" IS NULL;
UPDATE "AutoRecord" SET "triggerRoles" = DEFAULT WHERE "triggerRoles" IS NULL;
UPDATE "Guild" SET "accessRoles" = DEFAULT WHERE "accessRoles" IS NULL;
UPDATE "Patreon" SET "tiers" = DEFAULT WHERE "tiers" IS NULL;

-- AlterTable
ALTER TABLE "AutoRecord" ALTER COLUMN "triggerUsers" SET NOT NULL,
ALTER COLUMN "triggerRoles" SET NOT NULL;
ALTER TABLE "Guild" ALTER COLUMN "accessRoles" SET NOT NULL;
ALTER TABLE "Patreon" ALTER COLUMN "tiers" SET NOT NULL;
