-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "type" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateIndex
CREATE INDEX "Customer_departmentId_idx" ON "Customer"("departmentId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
