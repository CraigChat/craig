-- AlterTable
ALTER TABLE "PayoutTransaction" ADD COLUMN     "stripePayoutId" TEXT,
ADD COLUMN     "stripeTransferId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeAccountId" TEXT;

-- CreateIndex
CREATE INDEX "PayoutTransaction_stripeTransferId_idx" ON "PayoutTransaction"("stripeTransferId");
