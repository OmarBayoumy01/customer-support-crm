-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "slaPausedAt" TIMESTAMP(3),
ADD COLUMN     "slaPausedMs" INTEGER NOT NULL DEFAULT 0;
