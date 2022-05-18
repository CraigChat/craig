-- CreateTable
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);
