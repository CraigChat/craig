-- AlterTable
ALTER TABLE "AutoRecord" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid())::text,
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Ban" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Blessing" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Guild" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Patreon" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "UserToken" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateFunction
-- Keeps @updatedAt working for writes that don't go through Prisma Client; explicitly set values are left alone
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW."updatedAt" IS NOT DISTINCT FROM OLD."updatedAt" THEN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER "AutoRecord_set_updated_at" BEFORE UPDATE ON "AutoRecord" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "Ban_set_updated_at" BEFORE UPDATE ON "Ban" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "Blessing_set_updated_at" BEFORE UPDATE ON "Blessing" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "Guild_set_updated_at" BEFORE UPDATE ON "Guild" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "Patreon_set_updated_at" BEFORE UPDATE ON "Patreon" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "User_set_updated_at" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "UserToken_set_updated_at" BEFORE UPDATE ON "UserToken" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
