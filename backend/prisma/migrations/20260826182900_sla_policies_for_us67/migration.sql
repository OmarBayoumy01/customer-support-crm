-- CreateEnum
CREATE TYPE "SlaClock" AS ENUM ('FIRST_RESPONSE', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "EscalationTarget" AS ENUM ('ASSIGNEE', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER');

-- DropIndex
DROP INDEX "SlaPolicy_isActive_idx";

-- DropIndex
DROP INDEX "SlaPolicy_priority_departmentId_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isVip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SlaPolicy" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "customerIsVip" BOOLEAN,
ADD COLUMN     "customerType" "CustomerType",
ADD COLUMN     "specificity" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "priority" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SlaEscalationStep" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clock" "SlaClock" NOT NULL,
    "atPercent" INTEGER NOT NULL,
    "notify" "EscalationTarget" NOT NULL,
    "notifyUserId" TEXT,
    "changeStatusToEscalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaEscalationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlaEscalationStep_policyId_clock_atPercent_idx" ON "SlaEscalationStep"("policyId", "clock", "atPercent");

-- CreateIndex
CREATE UNIQUE INDEX "SlaEscalationStep_policyId_sequence_key" ON "SlaEscalationStep"("policyId", "sequence");

-- CreateIndex
CREATE INDEX "SlaPolicy_isActive_specificity_idx" ON "SlaPolicy"("isActive", "specificity");

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaEscalationStep" ADD CONSTRAINT "SlaEscalationStep_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaEscalationStep" ADD CONSTRAINT "SlaEscalationStep_notifyUserId_fkey" FOREIGN KEY ("notifyUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- US-6 guaranteed "exactly one platform default per priority" with a unique
-- index on (priority, departmentId). Priority is nullable now, and PostgreSQL
-- treats NULLs as distinct in a unique index, so that guarantee would quietly
-- evaporate: two rows of (NULL, NULL) would both be allowed and the resolver
-- would pick one of them by tiebreak.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+; we run 18) restores it across all six
-- matchers. Two policies that match exactly the same thing are a configuration
-- mistake, and the database is a better place to say so than a code review.
--
-- Partial, because a soft-deleted policy must not block a replacement.
--
-- Hand-written: Prisma has no schema syntax for NULLS NOT DISTINCT, so this is
-- appended to the generated migration rather than derived from the model.
CREATE UNIQUE INDEX "SlaPolicy_matchers_key"
  ON "SlaPolicy" (
    "priority",
    "categoryId",
    "departmentId",
    "branchId",
    "customerType",
    "customerIsVip"
  )
  NULLS NOT DISTINCT
  WHERE "deletedAt" IS NULL;
