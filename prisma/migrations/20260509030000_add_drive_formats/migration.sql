ALTER TABLE "User" ADD COLUMN "driveFormats" TEXT[] NOT NULL DEFAULT ARRAY['flac-zip']::TEXT[];

UPDATE "User"
SET "driveFormats" = ARRAY[COALESCE("driveFormat", 'flac') || '-' || COALESCE("driveContainer", 'zip')]::TEXT[]
WHERE "driveFormats" = ARRAY['flac-zip']::TEXT[]
  AND ("driveFormat" IS NOT NULL OR "driveContainer" IS NOT NULL);
