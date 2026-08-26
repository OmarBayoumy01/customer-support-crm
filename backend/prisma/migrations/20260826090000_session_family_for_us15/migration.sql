-- US-15. Refresh rotates a session, which means each refresh writes a new row;
-- every row descended from one login shares a `familyId` so a replayed token
-- can take the whole family down with it (AC3).
--
-- Written by hand rather than generated: `familyId` is required, and there are
-- already sessions in every environment this has to run against. Adding it
-- nullable, backfilling, then tightening is the non-destructive order —
-- generating it would have offered to drop the table instead.

-- 1. Nullable first, so the ALTER succeeds against existing rows.
ALTER TABLE "Session" ADD COLUMN "familyId" TEXT;
ALTER TABLE "Session" ADD COLUMN "replacedById" TEXT;

-- 2. Every session that predates families is the sole member of its own.
--    That is the truthful backfill: none of them has ever been rotated.
UPDATE "Session" SET "familyId" = "id" WHERE "familyId" IS NULL;

-- 3. Now it can be required.
ALTER TABLE "Session" ALTER COLUMN "familyId" SET NOT NULL;

-- One successor per session. A second row claiming to replace the same parent
-- would mean the rotation forked, which is the shape a replay attack leaves.
CREATE UNIQUE INDEX "Session_replacedById_key" ON "Session"("replacedById");

-- Revoking a whole family at once (AC3).
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
