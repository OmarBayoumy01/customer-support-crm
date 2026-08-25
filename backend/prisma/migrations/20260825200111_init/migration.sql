-- CreateTable
CREATE TABLE "MigrationProbe" (
    "id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationProbe_pkey" PRIMARY KEY ("id")
);
