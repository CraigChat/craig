-- CreateTable
CREATE TABLE "Entitlement" (
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "sourceEntitlementId" TEXT,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("userId","source")
);

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
